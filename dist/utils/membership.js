"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.botInstance = void 0;
exports.setBotInstance = setBotInstance;
exports.getRequiredChannels = getRequiredChannels;
exports.checkUserMembership = checkUserMembership;
exports.checkAllChannels = checkAllChannels;
exports.addRequiredChannel = addRequiredChannel;
exports.removeRequiredChannel = removeRequiredChannel;
exports.getWelcomeMessage = getWelcomeMessage;
exports.setWelcomeMessage = setWelcomeMessage;
exports.isUserVerified = isUserVerified;
exports.addVerifiedUser = addVerifiedUser;
exports.removeVerifiedUser = removeVerifiedUser;
const redis_js_1 = require("./redis.js");
function setBotInstance(bot) {
    exports.botInstance = bot;
}
const ACTIVE_STATUSES = [
    "creator",
    "administrator",
    "member",
    "restricted",
];
async function getRequiredChannels() {
    const data = await (0, redis_js_1.getSetting)("required_channels");
    if (!data)
        return [];
    try {
        return JSON.parse(data);
    }
    catch {
        return [];
    }
}
async function checkUserMembership(userId, channelChatId) {
    if (!exports.botInstance) {
        console.error("Bot instance not set for membership check");
        return false;
    }
    try {
        const chatMember = await exports.botInstance.telegram.getChatMember(channelChatId, userId);
        const status = chatMember.status;
        return ACTIVE_STATUSES.includes(status);
    }
    catch (err) {
        console.error(`Membership check failed for user ${userId} in ${channelChatId}:`, err.message);
        return false;
    }
}
async function checkAllChannels(userId) {
    const channels = await getRequiredChannels();
    if (channels.length === 0) {
        return { allJoined: true, missingChannels: [] };
    }
    const missing = [];
    for (const channel of channels) {
        const isMember = await checkUserMembership(userId, channel.chatId);
        if (!isMember) {
            missing.push(channel);
        }
    }
    return {
        allJoined: missing.length === 0,
        missingChannels: missing,
    };
}
async function addRequiredChannel(chatId, title) {
    const channels = await getRequiredChannels();
    const exists = channels.some((c) => c.chatId === chatId);
    if (!exists) {
        channels.push({ chatId, title });
        await (0, redis_js_1.setSetting)("required_channels", JSON.stringify(channels));
    }
}
async function removeRequiredChannel(chatId) {
    const channels = await getRequiredChannels();
    const filtered = channels.filter((c) => c.chatId !== chatId);
    await (0, redis_js_1.setSetting)("required_channels", JSON.stringify(filtered));
}
async function getWelcomeMessage() {
    const msg = await (0, redis_js_1.getSetting)("welcome_message");
    return msg || "Welcome! Thanks for joining our channels.";
}
async function setWelcomeMessage(text) {
    await (0, redis_js_1.setSetting)("welcome_message", text);
}
async function isUserVerified(userId) {
    const data = await (0, redis_js_1.getSetting)("verified_users");
    if (!data)
        return false;
    try {
        const users = JSON.parse(data);
        return users.includes(userId);
    }
    catch {
        return false;
    }
}
async function addVerifiedUser(userId) {
    const data = await (0, redis_js_1.getSetting)("verified_users");
    let users = [];
    if (data) {
        try {
            users = JSON.parse(data);
        }
        catch {
            users = [];
        }
    }
    if (!users.includes(userId)) {
        users.push(userId);
        await (0, redis_js_1.setSetting)("verified_users", JSON.stringify(users));
    }
}
async function removeVerifiedUser(userId) {
    const data = await (0, redis_js_1.getSetting)("verified_users");
    if (!data)
        return;
    try {
        const users = JSON.parse(data);
        const filtered = users.filter((id) => id !== userId);
        await (0, redis_js_1.setSetting)("verified_users", JSON.stringify(filtered));
    }
    catch {
        // Ignore
    }
}
