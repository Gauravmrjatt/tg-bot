import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import dotenv from "dotenv";
import pino from "pino";
import { connectDb } from "./utils/db.js";
import { connectRedis, getSetting, getAdminIds } from "./utils/redis.js";
import { UserModel } from "./models/index.js";
import { setupJoinRequest } from "./handlers/joinRequest.js";
import { setupAdminRelay } from "./handlers/adminRelay.js";
import { getTargetChatId } from "./utils/settings.js";
import { adminMainKeyboard, userMainKeyboard, cancelKeyboard, KB, esc } from "./utils/format.js";

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN not set");

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error("MONGO_URI not set");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const PORT = parseInt(process.env.SERVER_PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/tg-webhook";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL not set");

// Merge env-based admins with Redis-stored admins
const envAdmins = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const AdminSet = new Set<number>();
envAdmins.forEach((id) => AdminSet.add(id));

// Load admin IDs from DB at startup
async function loadAdmins() {
  const dbAdmins = await getAdminIds();
  dbAdmins.forEach((id) => AdminSet.add(id));
}

const bot = new Telegraf<Context>(TOKEN);
(bot as any).__adminSet = AdminSet;

// --- Middleware: track user activity (batched, non-blocking) ---
// Batch updates in memory and flush every 10s to reduce MongoDB write pressure
const activityBatch = new Map<number, { firstName: string; lastName?: string; username?: string; isAdmin: boolean; lastActiveAt: Date }>();
let activityFlushInterval: ReturnType<typeof setInterval> | null = null;

async function flushActivityBatch() {
  if (activityBatch.size === 0) return;
  const ops = [...activityBatch.entries()];
  activityBatch.clear();
  const bulkOps = ops.map(([tgId, data]) => ({
    updateOne: {
      filter: { tgId },
      update: { $set: { ...data } },
      upsert: true,
    },
  }));
  await UserModel.bulkWrite(bulkOps, { ordered: false }).catch(() => {});
}

function startActivityFlush() {
  if (activityFlushInterval) return;
  activityFlushInterval = setInterval(flushActivityBatch, 10_000);
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
  const isAdmin = AdminSet.has(ctx.from.id);
  const greeting = isAdmin
    ? "👋 *Hey admin, the bot is ready!*\n\nChoose an option below:"
    : "👋 *Hey, I'm alive and ready!*\n\nChoose an option below:";
  const kb = isAdmin ? adminMainKeyboard() : userMainKeyboard();
  return ctx.reply(greeting, { parse_mode: KB, reply_markup: kb.reply_markup });
});

// --- Non-command /admin: interactive keyboard buttons ---
bot.hears("📋 Help", async (ctx) => {
  let h = "📋 *Help*\n\n";
  h += "*/rejoin* — Get the channel invite link\n";
  h += "*💬 Message admin* — Just send me a message!\n\n";
  h += "🔒 _Admin buttons available in control panel._";
  await ctx.reply(h, { parse_mode: KB });
});

bot.hears("🔗 Rejoin", async (ctx) => {
  const inviteLink = await getSetting("channel_link");
  if (!inviteLink) {
    return ctx.reply("🔗 _Invite link is not configured._", { parse_mode: KB });
  }
  return ctx.reply(`🔗 *Click to join:*\n\n${inviteLink}`, { parse_mode: KB });
});

bot.hears("👤 My Info", async (ctx) => {
  const user = await UserModel.findOne({ tgId: ctx.from.id });
  let out = "👤 *Your Info*\n\n";
  out += `*ID:* \`${ctx.from.id}\`\n`;
  out += `*Name:* ${esc(ctx.from.first_name)}${ctx.from.last_name ? " " + esc(ctx.from.last_name) : ""}\n`;
  if (user) {
    out += `\n*Joined:* ${user.joinedAt.toISOString().slice(0, 10)}\n`;
    const sec = Math.floor((Date.now() - user.lastActiveAt.getTime()) / 1000);
    if (sec < 60) out += `*Last Active:* ${sec}s ago\n`;
    else if (sec < 3600) out += `*Last Active:* ${Math.floor(sec / 60)}m ago\n`;
    else if (sec < 86400) out += `*Last Active:* ${Math.floor(sec / 3600)}h ago\n`;
    else out += `*Last Active:* ${Math.floor(sec / 86400)}d ago\n`;
  }
  return ctx.reply(out, { parse_mode: KB });
});

bot.hears("💬 Message Admin", async (ctx) => {
  await ctx.reply("💬 _Just type your message and it will be forwarded to admins._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
});

// --- Admin keyboard buttons ---
bot.hears("📊 Stats", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  // Lazy import to avoid circular deps
  const { showStats } = await import("./handlers/stats.js");
  return showStats(ctx);
});

bot.hears("📢 Broadcast", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("📢 _Send the broadcast message now. Reply with your text or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "broadcast" });
});

bot.hears("⚡ Auto Approve", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  const { getAutoApprove, setAutoApprove } = await import("./utils/redis.js");
  const current = await getAutoApprove();
  await setAutoApprove(!current);
  return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}_.\n\n${!current ? "✅ Requests will be approved automatically." : "🛡️ Admin will review each request."}`, {
    parse_mode: KB,
    reply_markup: adminMainKeyboard().reply_markup,
  });
});

bot.hears("🔍 Bcast Status", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("🔍 _Send the broadcast ID to check status, or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "bcast_status" });
});

bot.hears("➕ Add Admin", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("➕ _Send the user ID to add as admin, or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "add_admin" });
});

bot.hears("➖ Remove Admin", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("➖ _Send the user ID to remove from admins, or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "remove_admin" });
});

bot.hears("👥 List Admins", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  const ids = [...AdminSet].map((id) => `\`${id}\``).join(", ");
  return ctx.reply(`🛡️ *Admins* (${AdminSet.size}):\n\n${ids}`, { parse_mode: KB });
});

bot.hears("⚙️ Config", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  const chatId = await getTargetChatId();
  const link = await getSetting("channel_link");
  let c = "⚙️ *Current Config*\n\n";
  c += `*Channel ID:* ${chatId ? `\`${chatId}\`` : "_not set_"}\n`;
  c += `*Invite Link:* ${link || "_not set_"}`;
  return ctx.reply(c, { parse_mode: KB });
});

bot.hears("📍 Set Channel", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("📍 _Send the channel chat ID (numeric), or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "set_channel" });
});

bot.hears("🔗 Set Link", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("🔗 _Send the Telegram invite link (https://t.me/...), or press Cancel._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "set_link" });
});

bot.hears("❌ Cancel", async (ctx) => {
  const { clearAdminState } = await import("./utils/redis.js");
  await clearAdminState(ctx.from.id);
  return ctx.reply("🔙 _Operation cancelled._", {
    parse_mode: KB,
    reply_markup: AdminSet.has(ctx.from.id) ? adminMainKeyboard().reply_markup : userMainKeyboard().reply_markup,
  });
});

// --- Manual command overrides (still work if typed) ---
bot.command("rejoin", async (ctx) => {
  const inviteLink = await getSetting("channel_link");
  if (!inviteLink) return ctx.reply("Invite link is not configured.");
  return ctx.reply(`Here's the invite link: ${inviteLink}`);
});

bot.command("config", async (ctx) => {
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: KB });
  const chatId = await getTargetChatId();
  const link = await getSetting("channel_link");
  let c = "⚙️ *Current Config*\n\n";
  c += `*Channel ID:* ${chatId ? `\`${chatId}\`` : "_not set_"}\n`;
  c += `*Invite Link:* ${link || "_not set_"}`;
  return ctx.reply(c, { parse_mode: KB });
});

// --- Admin management (commands still work as fallback) ---
bot.command("addadmin", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("➕ _Send the user ID to add as admin._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "add_admin" });
});

bot.command("removeadmin", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return;
  await ctx.reply("➖ _Send the user ID to remove._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "remove_admin" });
});

bot.command("setchannelid", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  await ctx.reply("📍 _Send the channel chat ID._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "set_channel" });
});

bot.command("setchannellink", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  await ctx.reply("🔗 _Send the invite link._", {
    parse_mode: KB,
    reply_markup: cancelKeyboard().reply_markup,
  });
  const { setAdminState } = await import("./utils/redis.js");
  await setAdminState(ctx.from.id, { action: "set_link" });
});

bot.command("autoapprove", async (ctx) => {
  if (!AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  const { getAutoApprove, setAutoApprove } = await import("./utils/redis.js");
  const current = await getAutoApprove();
  await setAutoApprove(!current);
  return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}.`, { parse_mode: KB });
});

// Setup feature handlers
function setup(bot: any, AdminSet: Set<number>) {
  setupJoinRequest(bot, AdminSet);
  setupAdminRelay(bot, AdminSet);
}

// --- Express server ---
async function main() {
  await connectDb(MONGO_URI!);
  logger.info("MongoDB connected");
  await connectRedis(REDIS_URL);
  await loadAdmins();

  // Register admin relay FIRST so it processes messages before other handlers
  setup(bot, AdminSet);

  await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));

  app.post(WEBHOOK_PATH, (req: Request, res: Response) => {
    bot.handleUpdate(req.body, res).catch((err) => {
      logger.error({ err }, "Webhook handler error");
    });
    res.sendStatus(200);
  });

  app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

  app.listen(PORT, () => {
    logger.info({ port: PORT, webhook: `${WEBHOOK_URL}${WEBHOOK_PATH}` }, "Bot listening");
  });
}

main().catch((err) => {
  logger.fatal(err);
  process.exit(1);
});
 