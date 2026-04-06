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
