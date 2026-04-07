"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.connectRedis = connectRedis;
exports.getAutoApprove = getAutoApprove;
exports.setAutoApprove = setAutoApprove;
exports.cachePendingRequest = cachePendingRequest;
exports.getPendingRequest = getPendingRequest;
exports.removePendingRequest = removePendingRequest;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.getAdminIds = getAdminIds;
exports.addAdminId = addAdminId;
exports.removeAdminId = removeAdminId;
exports.getAdminState = getAdminState;
exports.setAdminState = setAdminState;
exports.clearAdminState = clearAdminState;
exports.mapForwardedId = mapForwardedId;
exports.getForwardedAdminUser = getForwardedAdminUser;
exports.isUserBanned = isUserBanned;
exports.banUser = banUser;
exports.unbanUser = unbanUser;
exports.getBannedUserIds = getBannedUserIds;
const ioredis_1 = __importDefault(require("ioredis"));
async function connectRedis(url) {
    exports.redis = new ioredis_1.default(url, { retryStrategy: (times) => Math.min(times * 50, 2000) });
    exports.redis.on("error", (err) => console.error("Redis error:", err.message));
    await new Promise((resolve, reject) => {
        exports.redis.once("ready", resolve);
        exports.redis.once("error", reject);
    });
    console.log("Redis connected");
}
const AUTO_APPROVE_TTL = 3600; // 1h — cache TTL for auto_approve flag
async function getAutoApprove() {
    const cached = await exports.redis.get("setting:auto_approve");
    if (cached !== null)
        return cached === "1";
    return false;
}
async function setAutoApprove(value) {
    await exports.redis.set("setting:auto_approve", value ? "1" : "0", "EX", AUTO_APPROVE_TTL);
}
async function cachePendingRequest(userId, data) {
    await exports.redis.set(`joinreq:${userId}`, JSON.stringify(data), "EX", 3600);
}
async function getPendingRequest(userId) {
    const data = await exports.redis.get(`joinreq:${userId}`);
    return data ? JSON.parse(data) : null;
}
async function removePendingRequest(userId) {
    await exports.redis.del(`joinreq:${userId}`);
}
async function getSetting(key) {
    return exports.redis.get(`setting:${key}`);
}
async function setSetting(key, value) {
    await exports.redis.set(`setting:${key}`, value); // No TTL — settings persist indefinitely
}
async function getAdminIds() {
    // Try reading as set first
    try {
        const raw = await exports.redis.smembers("setting:admin_ids");
        return raw.map(Number);
    }
    catch (err) {
        // If WRONGTYPE, the key is still a string from old code — migrate it
        if (err.message?.includes("WRONGTYPE")) {
            const raw = await exports.redis.get("setting:admin_ids");
            const ids = raw ? JSON.parse(raw) : [];
            if (ids.length > 0) {
                await exports.redis.del("setting:admin_ids");
                await exports.redis.sadd("setting:admin_ids", ...ids.map(String));
            }
            return ids;
        }
        throw err;
    }
}
async function addAdminId(id) {
    await exports.redis.sadd("setting:admin_ids", String(id));
}
async function removeAdminId(id) {
    await exports.redis.srem("setting:admin_ids", String(id));
}
async function getAdminState(userId) {
    const data = await exports.redis.get(`adminstate:${userId}`);
    return data ? JSON.parse(data) : null;
}
async function setAdminState(userId, state) {
    await exports.redis.set(`adminstate:${userId}`, JSON.stringify(state), "EX", 300); // 5 min
}
async function clearAdminState(userId) {
    await exports.redis.del(`adminstate:${userId}`);
}
// --- Admin reply mapping — stores forwarded msg ID for EACH admin ---
async function mapForwardedId(adminChatId, adminMsgId, userId) {
    await exports.redis.set(`fwd:${adminChatId}:${adminMsgId}`, String(userId), "EX", 86400);
}
async function getForwardedAdminUser(adminChatId, adminMsgId) {
    const v = await exports.redis.get(`fwd:${adminChatId}:${adminMsgId}`);
    return v ? parseInt(v, 10) : null;
}
// --- Ban management — Redis set for fast lookups ---
async function isUserBanned(userId) {
    return exports.redis.sismember("banned:users", String(userId)).then(r => r === 1);
}
async function banUser(userId) {
    await exports.redis.sadd("banned:users", String(userId));
}
async function unbanUser(userId) {
    await exports.redis.srem("banned:users", String(userId));
}
async function getBannedUserIds() {
    const raw = await exports.redis.smembers("banned:users");
    return raw.map(Number);
}
