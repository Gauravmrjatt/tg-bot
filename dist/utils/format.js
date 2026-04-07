"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KB = void 0;
exports.esc = esc;
exports.userMainKeyboard = userMainKeyboard;
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
        ["📋 Help"],
        ["🔗 Rejoin", "👤 My Info"],
        ["💬 Message Admin"],
    ]).resize();
}
// Admin main keyboard
function adminMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📊 Stats", "📢 Broadcast"],
        ["⚡ Auto Approve", "🔍 Bcast Status"],
        ["➕ Add Admin", "➖ Remove Admin"],
        ["👥 List Admins", "⚙️ Config"],
        ["📍 Set Channel", "🔗 Set Link"],
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
