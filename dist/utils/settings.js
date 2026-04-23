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
const index_js_1 = require("../models/index.js");
async function getTargetChatId() {
    const v = await (0, redis_js_1.getSetting)("target_chat_id");
    if (v)
        return parseInt(v, 10);
    const db = await index_js_1.GlobalSettingsModel.findOne({ key: "targetChatId" });
    if (db?.value) {
        await (0, redis_js_1.setSetting)("target_chat_id", String(db.value));
        return db.value;
    }
    return null;
}
async function setTargetChatId(chatId) {
    await (0, redis_js_1.setSetting)("target_chat_id", String(chatId));
    await index_js_1.GlobalSettingsModel.findOneAndUpdate({ key: "targetChatId" }, { key: "targetChatId", value: chatId }, { upsert: true });
}
async function getChannelLink() {
    let v = await (0, redis_js_1.getSetting)("channel_link");
    if (v)
        return v;
    const db = await index_js_1.GlobalSettingsModel.findOne({ key: "channelLink" });
    if (db?.value) {
        await (0, redis_js_1.setSetting)("channel_link", db.value);
        return db.value;
    }
    return null;
}
async function setChannelLink(link) {
    await (0, redis_js_1.setSetting)("channel_link", link);
    await index_js_1.GlobalSettingsModel.findOneAndUpdate({ key: "channelLink" }, { key: "channelLink", value: link }, { upsert: true });
}
async function getWelcomeMessage() {
    const v = await (0, redis_js_1.getSetting)("welcome_message");
    if (v)
        return v;
    const db = await index_js_1.GlobalSettingsModel.findOne({ key: "welcomeMessage" });
    if (db?.value) {
        await (0, redis_js_1.setSetting)("welcome_message", db.value);
        return db.value;
    }
    return null;
}
async function setWelcomeMessage(msg) {
    await (0, redis_js_1.setSetting)("welcome_message", msg);
    await index_js_1.GlobalSettingsModel.findOneAndUpdate({ key: "welcomeMessage" }, { key: "welcomeMessage", value: msg }, { upsert: true });
}
async function getFolderLink() {
    const v = await (0, redis_js_1.getSetting)("folder_link");
    if (v)
        return v;
    const db = await index_js_1.GlobalSettingsModel.findOne({ key: "folderLink" });
    if (db?.value) {
        await (0, redis_js_1.setSetting)("folder_link", db.value);
        return db.value;
    }
    return null;
}
async function setFolderLink(link) {
    await (0, redis_js_1.setSetting)("folder_link", link);
    await index_js_1.GlobalSettingsModel.findOneAndUpdate({ key: "folderLink" }, { key: "folderLink", value: link }, { upsert: true });
}
