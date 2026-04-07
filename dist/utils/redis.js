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
const SETTING_TTL = 3600; // 1h
async function getAutoApprove() {
    const cached = await exports.redis.get("setting:auto_approve");
    if (cached !== null)
        return cached === "1";
    return false;
}
async function setAutoApprove(value) {
    await exports.redis.set("setting:auto_approve", value ? "1" : "0", "EX", SETTING_TTL);
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
    await exports.redis.set(`setting:${key}`, value, "EX", SETTING_TTL);
}
async function getAdminIds() {
    const raw = await exports.redis.get("setting:admin_ids");
    return raw ? JSON.parse(raw) : [];
}
async function addAdminId(id) {
    const ids = await getAdminIds();
    if (!ids.includes(id))
        ids.push(id);
    await exports.redis.set("setting:admin_ids", JSON.stringify(ids), "EX", SETTING_TTL);
}
async function removeAdminId(id) {
    const ids = await getAdminIds().then(list => list.filter(x => x !== id));
    await exports.redis.set("setting:admin_ids", JSON.stringify(ids), "EX", SETTING_TTL);
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
