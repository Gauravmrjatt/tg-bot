"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const pino_1 = __importDefault(require("pino"));
const db_js_1 = require("./utils/db.js");
const redis_js_1 = require("./utils/redis.js");
const index_js_1 = require("./models/index.js");
const joinRequest_js_1 = require("./handlers/joinRequest.js");
const adminRelay_js_1 = require("./handlers/adminRelay.js");
const settings_js_1 = require("./utils/settings.js");
const format_js_1 = require("./utils/format.js");
dotenv_1.default.config();
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || "info" });
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN)
    throw new Error("BOT_TOKEN not set");
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI)
    throw new Error("MONGO_URI not set");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const PORT = parseInt(process.env.SERVER_PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/tg-webhook";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL)
    throw new Error("WEBHOOK_URL not set");
// Merge env-based admins with Redis-stored admins
const envAdmins = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
const AdminSet = new Set();
envAdmins.forEach((id) => AdminSet.add(id));
// Load admin IDs from Redis at startup, fallback to MongoDB
async function loadAdmins() {
    // First try Redis
    const dbAdmins = await (0, redis_js_1.getAdminIds)();
    dbAdmins.forEach((id) => AdminSet.add(id));
    // Also check MongoDB for users marked as admin
    const mongoAdmins = await index_js_1.UserModel.find({ isAdmin: true }).lean();
    mongoAdmins.forEach((u) => AdminSet.add(u.tgId));
}
const bot = new telegraf_1.Telegraf(TOKEN);
bot.__adminSet = AdminSet;
// --- Middleware: track user activity (batched, non-blocking) ---
// Batch updates in memory and flush every 10s to reduce MongoDB write pressure
const activityBatch = new Map();
let activityFlushInterval = null;
async function flushActivityBatch() {
    if (activityBatch.size === 0)
        return;
    const ops = [...activityBatch.entries()];
    activityBatch.clear();
    const bulkOps = ops.map(([tgId, data]) => ({
        updateOne: {
            filter: { tgId },
            update: { $set: { ...data } },
            upsert: true,
        },
    }));
    await index_js_1.UserModel.bulkWrite(bulkOps, { ordered: false }).catch(() => { });
}
function startActivityFlush() {
    if (activityFlushInterval)
        return;
    activityFlushInterval = setInterval(flushActivityBatch, 10000);
    activityFlushInterval.unref(); // Don't keep process alive for this
}
bot.on("message", async (ctx, next) => {
    const user = ctx.from;
    activityBatch.set(user.id, {
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        isAdmin: AdminSet.has(user.id),
        lastActiveAt: new Date(),
    });
    return next();
});
startActivityFlush();
// --- /start — show main keyboard ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const isAdmin = AdminSet.has(userId);
    const requiredChannels = await (0, redis_js_1.getRequiredChannels)();
    if (!isAdmin && requiredChannels.length > 0) {
        const verifiedChatIds = await (0, redis_js_1.getUserVerifiedChannels)(userId);
        const verifiedSet = new Set(verifiedChatIds);
        const allJoined = requiredChannels.every(ch => verifiedSet.has(ch.chatId));
        if (!allJoined) {
            const folderLink = await (0, settings_js_1.getFolderLink)();
            if (folderLink) {
                return ctx.reply("Join our channels first:\n\n" + folderLink);
            }
            let msg = "Join these channels first:\n\n";
            for (const ch of requiredChannels) {
                msg += "- " + ch.name + "\n";
            }
            return ctx.reply(msg);
        }
    }
    const greeting = isAdmin
        ? "Hey admin, the bot is ready! Choose an option below:"
        : (await (0, settings_js_1.getWelcomeMessage)()) || "Welcome to OSM Support. Send your loot screenshots here.";
    const kb = isAdmin ? (0, format_js_1.adminMainKeyboard)() : (0, format_js_1.userMainKeyboard)();
    return ctx.reply(greeting, { reply_markup: kb.reply_markup });
});
// --- User buttons ---
bot.hears("📁 Join Channels", async (ctx) => {
    const folderLink = await (0, settings_js_1.getFolderLink)();
    if (folderLink) {
        return ctx.reply(folderLink);
    }
    return ctx.reply("No folder link set by admin.");
});
bot.hears("💬 Message Admin", async (ctx) => {
    const userId = ctx.from.id;
    const requiredChannels = await (0, redis_js_1.getRequiredChannels)();
    if (requiredChannels.length > 0 && !AdminSet.has(userId)) {
        const verifiedChatIds = await (0, redis_js_1.getUserVerifiedChannels)(userId);
        const verifiedSet = new Set(verifiedChatIds);
        const allJoined = requiredChannels.every(ch => verifiedSet.has(ch.chatId));
        if (!allJoined) {
            const folderLink = await (0, settings_js_1.getFolderLink)();
            if (folderLink) {
                return ctx.reply("Join our channels first:\n\n" + folderLink);
            }
            let msg = "Join these channels first:\n\n";
            for (const ch of requiredChannels) {
                msg += "- " + ch.name + "\n";
            }
            return ctx.reply(msg);
        }
    }
    await ctx.reply("Just type your message and it will be forwarded to admins.", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
});
// --- Admin buttons ---
bot.hears("⚙️ Config", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const chatId = await (0, settings_js_1.getTargetChatId)();
    const link = await (0, redis_js_1.getSetting)("channel_link");
    const welcome = await (0, settings_js_1.getWelcomeMessage)();
    const folder = await (0, settings_js_1.getFolderLink)();
    let c = "Current Config\n\n";
    c += "Channel ID: " + (chatId || "not set") + "\n";
    c += "Invite Link: " + (link || "not set") + "\n";
    c += "Welcome Msg: " + (welcome ? welcome.slice(0, 30) + "..." : "not set") + "\n";
    c += "Folder Link: " + (folder || "not set");
    return ctx.reply(c);
});
bot.hears("💬 Welcome Msg", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("Send the welcome message to show users:", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_welcome_msg" });
});
bot.hears("📁 Set Folder", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("Send the Telegram folder link:", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_folder_link" });
});
bot.hears("📋 Manage Channels", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const channels = await (0, redis_js_1.getRequiredChannels)();
    let msg = "Required Channels\n\n";
    if (channels.length === 0) {
        msg += "No channels configured.";
    }
    else {
        for (const ch of channels) {
            msg += "- " + ch.name + " (" + ch.chatId + ")\n";
        }
    }
    const rows = [];
    for (const ch of channels) {
        rows.push([telegraf_1.Markup.button.callback("Remove " + ch.name, "remove_channel:" + ch.chatId)]);
    }
    rows.push([telegraf_1.Markup.button.callback("Add Channel", "add_channel_flow")]);
    return ctx.reply(msg, { reply_markup: { inline_keyboard: rows } });
});
bot.hears("🔗 Set Link", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("Send the Telegram invite link:", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_link" });
});
bot.hears("📍 Approve Channel", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("Send the channel chat ID:", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_channel" });
});
// --- Admin keyboard buttons ---
bot.hears("📊 Stats", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const { showStats } = await Promise.resolve().then(() => __importStar(require("./handlers/stats.js")));
    return showStats(ctx);
});
bot.hears("📢 Broadcast", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("📢 _Send the broadcast message now. Reply with your text or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "broadcast" });
});
bot.hears("⚡ Auto Approve", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const { getAutoApprove, setAutoApprove } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}_.\n\n${!current ? "✅ Requests will be approved automatically." : "🛡️ Admin will review each request."}`, {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
    });
});
bot.hears("🔍 Bcast Status", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("🔍 _Send the broadcast ID to check status, or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "bcast_status" });
});
bot.hears("➕ Add Admin", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("➕ _Send the user ID to add as admin, or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "add_admin" });
});
bot.hears("➖ Remove Admin", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("➖ _Send the user ID to remove from admins, or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "remove_admin" });
});
bot.hears("👥 List Admins", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const ids = [...AdminSet].map((id) => `\`${id}\``).join(", ");
    return ctx.reply(`🛡️ *Admins* (${AdminSet.size}):\n\n${ids}`, { parse_mode: format_js_1.KB });
});
bot.hears("⚙️ Config", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    const chatId = await (0, settings_js_1.getTargetChatId)();
    const link = await (0, redis_js_1.getSetting)("channel_link");
    let c = "⚙️ *Current Config*\n\n";
    c += `*Channel ID:* ${chatId ? `\`${chatId}\`` : "_not set_"}\n`;
    c += `*Invite Link:* ${link || "_not set_"}`;
    return ctx.reply(c, { parse_mode: format_js_1.KB });
});
bot.hears("📍 Set Channel", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("📍 _Send the channel chat ID (numeric), or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_channel" });
});
bot.hears("🔗 Set Link", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("🔗 _Send the Telegram invite link (https://t.me/...), or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_link" });
});
bot.hears("🚫 Ban User", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("🚫 _Send the user ID to ban, or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "ban_user" });
});
bot.hears("✅ Unban User", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("✅ _Send the user ID to unban, or press Cancel._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "unban_user" });
});
bot.hears("📋 List Banned", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    return showBannedList(ctx, 1);
});
async function showBannedList(ctx, page) {
    const { UserModel } = await Promise.resolve().then(() => __importStar(require("./models/index.js")));
    const { Markup } = await Promise.resolve().then(() => __importStar(require("telegraf")));
    const perPage = 10;
    const total = await UserModel.countDocuments({ isBanned: true });
    if (total === 0) {
        return ctx.reply("📋 _No banned users._", { parse_mode: format_js_1.KB });
    }
    const totalPages = Math.ceil(total / perPage);
    if (page > totalPages)
        page = totalPages;
    if (page < 1)
        page = 1;
    const banned = await UserModel.find({ isBanned: true }, { tgId: 1, username: 1, firstName: 1, lastName: 1 })
        .sort({ _id: 1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean();
    let msg = `🚫 *Banned Users* (${total})\n`;
    msg += `*Page* ${page}/${totalPages}\n\n`;
    for (const u of banned) {
        const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "N/A";
        const un = u.username ? `@${u.username}` : "no username";
        msg += `• \`${u.tgId}\` — ${name} (${un})\n`;
    }
    const kb = [];
    if (page > 1 || page < totalPages) {
        const row = [];
        if (page > 1)
            row.push(Markup.button.callback("⬅️ Prev", `banned_list:${page - 1}`));
        if (page < totalPages)
            row.push(Markup.button.callback("Next ➡️", `banned_list:${page + 1}`));
        kb.push(row);
    }
    return ctx.reply(msg, { parse_mode: format_js_1.KB, reply_markup: { inline_keyboard: kb } });
}
bot.action(/^banned_list:(\d+)$/, async (ctx) => {
    if (!AdminSet.has(ctx.callbackQuery.from.id))
        return ctx.answerCbQuery("Not authorized.");
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await showBannedList(ctx, page);
});
bot.action("add_channel_flow", async (ctx) => {
    if (!AdminSet.has(ctx.callbackQuery.from.id))
        return ctx.answerCbQuery("Not authorized.");
    await ctx.answerCbQuery();
    await ctx.reply("Add Channel - Step 1/3: Send the channel name:", {
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "add_channel", data: { step: "name" } });
});
bot.action(/^remove_channel:(\-?\d+)$/, async (ctx) => {
    if (!AdminSet.has(ctx.callbackQuery.from.id))
        return ctx.answerCbQuery("Not authorized.");
    const chatId = parseInt(ctx.match[1], 10);
    await (0, redis_js_1.removeRequiredChannel)(chatId);
    await ctx.answerCbQuery("Channel removed!");
    const channels = await (0, redis_js_1.getRequiredChannels)();
    let msg = "Required Channels\n\n";
    if (channels.length === 0) {
        msg += "No channels configured.";
    }
    else {
        for (const ch of channels) {
            msg += "- " + ch.name + " (" + ch.chatId + ")\n";
        }
    }
    const rows = [];
    for (const ch of channels) {
        rows.push([telegraf_1.Markup.button.callback("Remove " + ch.name, "remove_channel:" + ch.chatId)]);
    }
    rows.push([telegraf_1.Markup.button.callback("Add Channel", "add_channel_flow")]);
    await ctx.editMessageText(msg, { reply_markup: { inline_keyboard: rows } });
});
bot.hears("❌ Cancel", async (ctx) => {
    const { clearAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await clearAdminState(ctx.from.id);
    return ctx.reply("🔙 _Operation cancelled._", {
        parse_mode: format_js_1.KB,
        reply_markup: AdminSet.has(ctx.from.id) ? (0, format_js_1.adminMainKeyboard)().reply_markup : (0, format_js_1.userMainKeyboard)().reply_markup,
    });
});
// --- Manual command overrides (still work if typed) ---
bot.command("rejoin", async (ctx) => {
    const inviteLink = await (0, redis_js_1.getSetting)("channel_link");
    if (!inviteLink)
        return ctx.reply("Invite link is not configured.");
    return ctx.reply(`Here's the invite link: ${inviteLink}`);
});
bot.command("config", async (ctx) => {
    if (!ctx.from || !AdminSet.has(ctx.from.id))
        return ctx.reply("🛡️ _Admin only._", { parse_mode: format_js_1.KB });
    const chatId = await (0, settings_js_1.getTargetChatId)();
    const link = await (0, redis_js_1.getSetting)("channel_link");
    let c = "⚙️ *Current Config*\n\n";
    c += `*Channel ID:* ${chatId ? `\`${chatId}\`` : "_not set_"}\n`;
    c += `*Invite Link:* ${link || "_not set_"}`;
    return ctx.reply(c, { parse_mode: format_js_1.KB });
});
// --- Admin management (commands still work as fallback) ---
bot.command("addadmin", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("➕ _Send the user ID to add as admin._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "add_admin" });
});
bot.command("removeadmin", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    await ctx.reply("➖ _Send the user ID to remove._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "remove_admin" });
});
bot.command("setchannelid", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return ctx.reply("Admin only.");
    await ctx.reply("📍 _Send the channel chat ID._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_channel" });
});
bot.command("setchannellink", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return ctx.reply("Admin only.");
    await ctx.reply("🔗 _Send the invite link._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
    const { setAdminState } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    await setAdminState(ctx.from.id, { action: "set_link" });
});
bot.command("autoapprove", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return ctx.reply("Admin only.");
    const { getAutoApprove, setAutoApprove } = await Promise.resolve().then(() => __importStar(require("./utils/redis.js")));
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}.`, { parse_mode: format_js_1.KB });
});
// bot.command("ban", async (ctx) => {
//   if (!AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
//   await ctx.reply("🚫 _Send the user ID to ban._", {
//     parse_mode: KB,
//     reply_markup: cancelKeyboard().reply_markup,
//   });
//   const { setAdminState } = await import("./utils/redis.js");
//   await setAdminState(ctx.from.id, { action: "ban_user" });
// });
// bot.command("unban", async (ctx) => {
//   if (!AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
//   await ctx.reply("✅ _Send the user ID to unban._", {
//     parse_mode: KB,
//     reply_markup: cancelKeyboard().reply_markup,
//   });
//   const { setAdminState } = await import("./utils/redis.js");
//   await setAdminState(ctx.from.id, { action: "unban_user" });
// });
// Setup feature handlers
function setup(bot, AdminSet) {
    (0, joinRequest_js_1.setupJoinRequest)(bot, AdminSet);
    (0, adminRelay_js_1.setupAdminRelay)(bot, AdminSet);
}
// --- Express server ---
async function main() {
    await (0, db_js_1.connectDb)(MONGO_URI);
    logger.info("MongoDB connected");
    await (0, redis_js_1.connectRedis)(REDIS_URL);
    await loadAdmins();
    // Register admin relay FIRST so it processes messages before other handlers
    setup(bot, AdminSet);
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
    const app = (0, express_1.default)();
    app.set("trust proxy", 1);
    app.use(express_1.default.json({ limit: "50mb" }));
    app.post(WEBHOOK_PATH, (req, res) => {
        console.log("wehbook");
        bot.handleUpdate(req.body, res).catch((err) => {
            logger.error({ err }, "Webhook handler error");
        });
        res.sendStatus(200);
    });
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    app.listen(PORT, () => {
        logger.info({ port: PORT, webhook: `${WEBHOOK_URL}${WEBHOOK_PATH}` }, "Bot listening");
    });
}
main().catch((err) => {
    logger.fatal(err);
    process.exit(1);
});
