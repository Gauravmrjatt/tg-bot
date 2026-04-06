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

// Cache helpers
const CACHE_TTL = 300; // 5 min

export async function getAutoApprove(): Promise<boolean> {
  const cached = await redis.get("setting:auto_approve");
  if (cached !== null) return cached === "1";
  return false;
}

export async function setAutoApprove(value: boolean): Promise<void> {
  await redis.set("setting:auto_approve", value ? "1" : "0", "EX", CACHE_TTL);
}

export async function cachePendingRequest(userId: number, data: Record<string, unknown>) {
  await redis.set(`joinreq:${userId}`, JSON.stringify(data), "EX", 3600); // expire after 1h
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
  await redis.set(`setting:${key}`, value);
}

// Cache the original user_id -> forwardedMessage mapping for reply-by-reply
export async function cacheForwardedId(forwardMsgId: number, userId: number) {
  await redis.set(`fwd:${forwardMsgId}`, String(userId), "EX", 86400); // 24h
}

export async function getForwardedUser(forwardMsgId: number): Promise<number | null> {
  const v = await redis.get(`fwd:${forwardMsgId}`);
  return v ? parseInt(v, 10) : null;
}
