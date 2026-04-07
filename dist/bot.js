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
// Load admin IDs from DB at startup
async function loadAdmins() {
    const dbAdmins = await (0, redis_js_1.getAdminIds)();
    dbAdmins.forEach((id) => AdminSet.add(id));
}
const bot = new telegraf_1.Telegraf(TOKEN);
bot.__adminSet = AdminSet;
// --- Middleware: track user activity (non-blocking) ---
bot.on("message", async (ctx, next) => {
    const user = ctx.from;
    // Fire-and-forget — don't block the pipeline
    index_js_1.UserModel.updateOne({ tgId: user.id }, {
        $set: {
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            isAdmin: AdminSet.has(user.id),
            lastActiveAt: new Date(),
        },
    }, { upsert: true }).catch(() => { });
    return next();
});
// --- /start — show main keyboard ---
bot.start(async (ctx) => {
    const isAdmin = AdminSet.has(ctx.from.id);
    const greeting = isAdmin
        ? "👋 *Hey admin, the bot is ready!*\n\nChoose an option below:"
        : "👋 *Hey, I'm alive and ready!*\n\nChoose an option below:";
    const kb = isAdmin ? (0, format_js_1.adminMainKeyboard)() : (0, format_js_1.userMainKeyboard)();
    return ctx.reply(greeting, { parse_mode: format_js_1.KB, reply_markup: kb.reply_markup });
});
// --- Non-command /admin: interactive keyboard buttons ---
bot.hears("📋 Help", async (ctx) => {
    let h = "📋 *Help*\n\n";
    h += "*/rejoin* — Get the channel invite link\n";
    h += "*💬 Message admin* — Just send me a message!\n\n";
    h += "🔒 _Admin buttons available in control panel._";
    await ctx.reply(h, { parse_mode: format_js_1.KB });
});
bot.hears("🔗 Rejoin", async (ctx) => {
    const inviteLink = await (0, redis_js_1.getSetting)("channel_link");
    if (!inviteLink) {
        return ctx.reply("🔗 _Invite link is not configured._", { parse_mode: format_js_1.KB });
    }
    return ctx.reply(`🔗 *Click to join:*\n\n${inviteLink}`, { parse_mode: format_js_1.KB });
});
bot.hears("👤 My Info", async (ctx) => {
    const user = await index_js_1.UserModel.findOne({ tgId: ctx.from.id });
    let out = "👤 *Your Info*\n\n";
    out += `*ID:* \`${ctx.from.id}\`\n`;
    out += `*Name:* ${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}\n`;
    if (user) {
        out += `\n*Joined:* ${user.joinedAt.toISOString().slice(0, 10)}\n`;
        const sec = Math.floor((Date.now() - user.lastActiveAt.getTime()) / 1000);
        if (sec < 60)
            out += `*Last Active:* ${sec}s ago\n`;
        else if (sec < 3600)
            out += `*Last Active:* ${Math.floor(sec / 60)}m ago\n`;
        else if (sec < 86400)
            out += `*Last Active:* ${Math.floor(sec / 3600)}h ago\n`;
        else
            out += `*Last Active:* ${Math.floor(sec / 86400)}d ago\n`;
    }
    return ctx.reply(out, { parse_mode: format_js_1.KB });
});
bot.hears("💬 Message Admin", async (ctx) => {
    await ctx.reply("💬 _Just type your message and it will be forwarded to admins._", {
        parse_mode: format_js_1.KB,
        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
    });
});
// --- Admin keyboard buttons ---
bot.hears("📊 Stats", async (ctx) => {
    if (!AdminSet.has(ctx.from.id))
        return;
    // Lazy import to avoid circular deps
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
    const { GlobalSettingsModel } = await Promise.resolve().then(() => __importStar(require("./models/index.js")));
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    const setting = await GlobalSettingsModel.findOne({ key: "auto_approve" });
    if (setting) {
        setting.value = !current;
        await setting.save();
    }
    else {
        await GlobalSettingsModel.create({ key: "auto_approve", value: !current });
    }
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
    const { GlobalSettingsModel } = await Promise.resolve().then(() => __importStar(require("./models/index.js")));
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    const setting = await GlobalSettingsModel.findOne({ key: "auto_approve" });
    if (setting) {
        setting.value = !current;
        await setting.save();
    }
    else {
        await GlobalSettingsModel.create({ key: "auto_approve", value: !current });
    }
    return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}.`, { parse_mode: format_js_1.KB });
});
// Setup feature handlers (called inside main() after async imports resolve)
function setup(bot, AdminSet) {
    (0, joinRequest_js_1.setupJoinRequest)(bot, AdminSet);
    Promise.resolve().then(() => __importStar(require("./handlers/adminRelay.js"))).then(({ setupAdminRelay }) => {
        setupAdminRelay(bot, AdminSet);
    });
}
// --- Express server ---
async function main() {
    await (0, db_js_1.connectDb)(MONGO_URI);
    logger.info("MongoDB connected");
    setup(bot, AdminSet);
    await (0, redis_js_1.connectRedis)(REDIS_URL);
    await loadAdmins();
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
    const app = (0, express_1.default)();
    app.set("trust proxy", 1);
    app.use(express_1.default.json({ limit: "50mb" }));
    app.post(WEBHOOK_PATH, (req, res) => {
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
