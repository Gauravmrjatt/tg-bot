import Redis from "ioredis";

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

const SETTING_TTL = 3600; // 1h

export async function getAutoApprove(): Promise<boolean> {
  const cached = await redis.get("setting:auto_approve");
  if (cached !== null) return cached === "1";
  return false;
}

export async function setAutoApprove(value: boolean): Promise<void> {
  await redis.set("setting:auto_approve", value ? "1" : "0", "EX", SETTING_TTL);
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

// Settings always cached with TTL
export async function getSetting(key: string): Promise<string | null> {
  return redis.get(`setting:${key}`);
}

export async function setSetting(key: string, value: string) {
  await redis.set(`setting:${key}`, value, "EX", SETTING_TTL);
}

export async function cacheForwardedId(forwardMsgId: number, userId: number) {
  await redis.set(`fwd:${forwardMsgId}`, String(userId), "EX", 86400);
}

export async function getForwardedUser(forwardMsgId: number): Promise<number | null> {
  const v = await redis.get(`fwd:${forwardMsgId}`);
  return v ? parseInt(v, 10) : null;
}

export async function getAdminIds(): Promise<number[]> {
  const raw = await redis.get("setting:admin_ids");
  return raw ? JSON.parse(raw) : [];
}

export async function addAdminId(id: number) {
  const ids = await getAdminIds();
  if (!ids.includes(id)) ids.push(id);
  await redis.set("setting:admin_ids", JSON.stringify(ids), "EX", SETTING_TTL);
}

export async function removeAdminId(id: number) {
  const ids = await getAdminIds().then(list => list.filter(x => x !== id));
  await redis.set("setting:admin_ids", JSON.stringify(ids), "EX", SETTING_TTL);
}
