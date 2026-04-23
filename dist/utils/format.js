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
function esc(s) {
    return s.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}
function userMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📁 Join Channels", "💬 Message Admin"],
    ]).resize();
}
function adminMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📊 Stats", "📢 Broadcast"],
        ["⚡ Auto Approve", "🔍 Bcast Status"],
        ["➕ Add Admin", "➖ Remove Admin"],
        ["👥 List Admins", "⚙️ Config"],
        ["📍 Approve Channel", "🔗 Set Link"],
        ["📁 Set Folder", "💬 Welcome Msg"],
        ["📋 Manage Channels", "🚫 Ban User"],
        ["✅ Unban User", "📋 List Banned"],
    ]).resize();
}
function cancelKeyboard() {
    return telegraf_1.Markup.keyboard([["❌ Cancel"]]).resize();
}
function removeKeyboard() {
    return telegraf_1.Markup.removeKeyboard();
}
