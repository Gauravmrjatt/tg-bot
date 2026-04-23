"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KB = void 0;
exports.esc = esc;
exports.userMainKeyboard = userMainKeyboard;
exports.userWelcomeKeyboard = userWelcomeKeyboard;
exports.channelVerificationKeyboard = channelVerificationKeyboard;
exports.viewChannelsKeyboard = viewChannelsKeyboard;
exports.channelListKeyboard = channelListKeyboard;
exports.adminMainKeyboard = adminMainKeyboard;
exports.cancelKeyboard = cancelKeyboard;
exports.removeKeyboard = removeKeyboard;
const telegraf_1 = require("telegraf");
const KB = "Markdown";
exports.KB = KB;
// Escape special characters for Telegram MarkdownV2/Markdown
function esc(s) {
    return s.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}
// User main keyboard — reply buttons at bottom
function userMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📁 Join Channels", "💬 Message Admin"],
    ]).resize();
}
// Welcome message keyboard for verified users
function userWelcomeKeyboard(welcomeMsg) {
    return telegraf_1.Markup.keyboard([
    //["🔗 Rejoin", "💬 Message Admin"],
    ]).resize();
}
// Channel verification keyboard
function channelVerificationKeyboard(channels) {
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ I Have Joined", "verify_channels")],
        [telegraf_1.Markup.button.callback("📋 View Channels", "view_channels")],
    ]);
}
// View channels keyboard with join buttons
function viewChannelsKeyboard(channels) {
    const rows = [];
    for (const ch of channels) {
        rows.push([telegraf_1.Markup.button.url(`➕ Join ${ch.name}`, ch.inviteLink)]);
    }
    rows.push([telegraf_1.Markup.button.callback("✅ I Have Joined", "verify_channels")]);
    return telegraf_1.Markup.inlineKeyboard(rows);
}
// Remove channel keyboard
function channelListKeyboard(channels) {
    const rows = [];
    for (const ch of channels) {
        rows.push([telegraf_1.Markup.button.callback(`❌ Remove ${ch.name}`, `remove_channel:${ch.chatId}`)]);
    }
    rows.push([telegraf_1.Markup.button.callback("➕ Add Channel", "add_channel_flow")]);
    rows.push([telegraf_1.Markup.button.callback("🔙 Back", "admin_back")]);
    return telegraf_1.Markup.inlineKeyboard(rows);
}
// Admin main keyboard
function adminMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📊 Stats", "📢 Broadcast"],
        ["⚡ Auto Approve", "🔍 Bcast Status"],
        ["➕ Add Admin", "➖ Remove Admin"],
        ["👥 List Admins", "⚙️ Config"],
        ["📍 Approve Channel", "🔗 Set Link"],
        ["📁 Set Folder", "💬 Welcome Msg"],
        ["📋 Manage Channels", "🚫 Ban User"],
        ["✅ Unban User"],
    ]).resize();
}
// Cancel button — shown during conversational flows
function cancelKeyboard() {
    return telegraf_1.Markup.keyboard([["❌ Cancel"]]).resize();
}
// Remove custom keyboard
function removeKeyboard() {
    return telegraf_1.Markup.removeKeyboard();
}
