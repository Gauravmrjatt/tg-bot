"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTargetChatId = getTargetChatId;
exports.setTargetChatId = setTargetChatId;
exports.getChannelLink = getChannelLink;
exports.setChannelLink = setChannelLink;
exports.getWelcomeMessage = getWelcomeMessage;
exports.setWelcomeMessage = setWelcomeMessage;
exports.getFolderLink = getFolderLink;
exports.setFolderLink = setFolderLink;
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
async function getWelcomeMessage() {
    return (0, redis_js_1.getSetting)("welcome_message");
}
async function setWelcomeMessage(msg) {
    await (0, redis_js_1.setSetting)("welcome_message", msg);
}
async function getFolderLink() {
    return (0, redis_js_1.getSetting)("folder_link");
}
async function setFolderLink(link) {
    await (0, redis_js_1.setSetting)("folder_link", link);
}
