"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTargetChatId = getTargetChatId;
exports.setTargetChatId = setTargetChatId;
exports.getChannelLink = getChannelLink;
exports.setChannelLink = setChannelLink;
const redis_js_1 = require("./redis.js");
async function getTargetChatId() {
    const v = await (0, redis_js_1.getSetting)("target_chat_id");
    return v ? parseInt(v, 10) : null;
}
async function setTargetChatId(chatId) {
    await (0, redis_js_1.setSetting)("target_chat_id", String(chatId));
}
async function getChannelLink() {
    return (0, redis_js_1.getSetting)("channel_link");
}
async function setChannelLink(link) {
    await (0, redis_js_1.setSetting)("channel_link", link);
}
