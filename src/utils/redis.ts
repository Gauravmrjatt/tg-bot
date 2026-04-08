import Redis from "ioredis";
import { GlobalSettingsModel } from "../models/index.js";

export let redis: Redis;

export async function connectRedis(url: string) {
  redis = new Redis(url, { retryStrategy: (times) => Math.min(times * 50, 2000) });
  redis.on("error", (err) => console.error("Redis error:", err.message));
  await new Promise((resolve, reject) => {
    redis.once("ready", resolve);
    redis.once("error", reject);
  });
  console.log("Redis connected");
}

const AUTO_APPROVE_TTL = 3600; // 1h — cache TTL for auto_approve flag

export async function getAutoApprove(): Promise<boolean> {
  const cached = await redis.get("setting:auto_approve");
  if (cached !== null) return cached === "1";

  const dbSetting = await GlobalSettingsModel.findOne({ key: "autoApprove" });
  const value = dbSetting?.value === true;
  await redis.set("setting:auto_approve", value ? "1" : "0", "EX", AUTO_APPROVE_TTL);
  return value;
}

export async function setAutoApprove(value: boolean): Promise<void> {
  await GlobalSettingsModel.findOneAndUpdate(
    { key: "autoApprove" },
    { key: "autoApprove", value },
    { upsert: true },
  );
  await redis.set("setting:auto_approve", value ? "1" : "0", "EX", AUTO_APPROVE_TTL);
}

export async function cachePendingRequest(userId: number, data: Record<string, unknown>) {
  await redis.set(`joinreq:${userId}`, JSON.stringify(data), "EX", 3600);
}

export async function getPendingRequest(userId: number): Promise<Record<string, unknown> | null> {
  const data = await redis.get(`joinreq:${userId}`);
  return data ? JSON.parse(data) : null;
}

export async function removePendingRequest(userId: number) {
  await redis.del(`joinreq:${userId}`);
}

export async function getSetting(key: string): Promise<string | null> {
  return redis.get(`setting:${key}`);
}

export async function setSetting(key: string, value: string) {
  await redis.set(`setting:${key}`, value); // No TTL — settings persist indefinitely
}

export async function getAdminIds(): Promise<number[]> {
  // Try reading as set first
  try {
    const raw = await redis.smembers("setting:admin_ids");
    return raw.map(Number);
  } catch (err: any) {
    // If WRONGTYPE, the key is still a string from old code — migrate it
    if (err.message?.includes("WRONGTYPE")) {
      const raw = await redis.get("setting:admin_ids");
      const ids: number[] = raw ? JSON.parse(raw) : [];
      if (ids.length > 0) {
        await redis.del("setting:admin_ids");
        await redis.sadd("setting:admin_ids", ...ids.map(String));
      }
      return ids;
    }
    throw err;
  }
}

export async function addAdminId(id: number) {
  await redis.sadd("setting:admin_ids", String(id));
}

export async function removeAdminId(id: number) {
  await redis.srem("setting:admin_ids", String(id));
}

// --- Conversational state ---
// Tracks per-user state for interactive flows: action="add_admin" | "remove_admin" | "set_channel" | "set_link"
export type AdminState = { action: string; adminChatId?: number; adminMsgId?: number; data?: any };

export async function getAdminState(userId: number): Promise<AdminState | null> {
  const data = await redis.get(`adminstate:${userId}`);
  return data ? JSON.parse(data) : null;
}

export async function setAdminState(userId: number, state: AdminState) {
  await redis.set(`adminstate:${userId}`, JSON.stringify(state), "EX", 300); // 5 min
}

export async function clearAdminState(userId: number) {
  await redis.del(`adminstate:${userId}`);
}

// --- Admin reply mapping — stores forwarded msg ID for EACH admin ---
export async function mapForwardedId(adminChatId: number, adminMsgId: number, userId: number) {
  await redis.set(`fwd:${adminChatId}:${adminMsgId}`, String(userId), "EX", 86400);
}

export async function getForwardedAdminUser(adminChatId: number, adminMsgId: number): Promise<number | null> {
  const v = await redis.get(`fwd:${adminChatId}:${adminMsgId}`);
  return v ? parseInt(v, 10) : null;
}

// --- Ban management — Redis set for fast lookups ---
export async function isUserBanned(userId: number): Promise<boolean> {
  return redis.sismember("banned:users", String(userId)).then(r => r === 1);
}

export async function banUser(userId: number) {
  await redis.sadd("banned:users", String(userId));
}

export async function unbanUser(userId: number) {
  await redis.srem("banned:users", String(userId));
}

export async function getBannedUserIds(): Promise<number[]> {
  const raw = await redis.smembers("banned:users");
  return raw.map(Number);
}
