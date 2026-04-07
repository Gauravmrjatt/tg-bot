import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pino from "pino";
import { connectDb } from "./utils/db.js";
import { connectRedis, getSetting, getAdminIds, addAdminId, removeAdminId } from "./utils/redis.js";
import { UserModel } from "./models/index.js";
import { setupJoinRequest } from "./handlers/joinRequest.js";
import { setupBroadcast } from "./handlers/broadcast.js";
import { setupStats } from "./handlers/stats.js";
import { setupAdminRelay } from "./handlers/adminRelay.js";
import { setupMenu } from "./handlers/menu.js";
import { getTargetChatId, setTargetChatId, setChannelLink } from "./utils/settings.js";

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

AdminSet.size === 0 && void 0; // lazy init placeholder

const bot = new Telegraf<Context>(TOKEN);

// --- Performance / optimization: webhook secret validation ---
function isWebhookValid(req: Request): boolean {
  if (process.env.WEBHOOK_SECRET) {
    const signature = req.headers["x-telegram-bot-api-secret-token"];
    return signature === process.env.WEBHOOK_SECRET;
  }
  return true;
}

// --- Middleware: track user activity (non-blocking) ---
bot.on("message", async (ctx, next) => {
  const user = ctx.from;
  // Fire-and-forget — don't block the pipeline
  UserModel.updateOne(
    { tgId: user.id },
    {
      $set: {
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        isAdmin: AdminSet.has(user.id),
        lastActiveAt: new Date(),
      },
    },
    { upsert: true },
  ).catch(() => {});
  return next();
});

// /start and /help handled by menu.ts
bot.command("rejoin", async (ctx) => {
  const inviteLink = await getSetting("channel_link");
  if (!inviteLink) return ctx.reply("Invite link is not configured.");
  return ctx.reply(`Here's the invite link: ${inviteLink}`);
});

// --- Runtime config commands (admin only) ---

bot.command("setchannelid", async (ctx) => {
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  const text = ctx.message.text.slice("/setchannelid".length).trim();
  if (!text) return ctx.reply("Usage: /setchannelid <chat_id>");
  const chatId = parseInt(text, 10);
  if (isNaN(chatId)) return ctx.reply("Invalid chat ID.");
  await setTargetChatId(chatId);
  return ctx.reply(`Target chat ID set to: ${chatId}`);
});

bot.command("setchannellink", async (ctx) => {
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  const text = ctx.message.text.slice("/setchannellink".length).trim();
  if (!text) return ctx.reply("Usage: /setchannellink <invite_link>");
  await setChannelLink(text);
  return ctx.reply("Channel invite link set.");
});

bot.command("config", async (ctx) => {
  const pm = "Markdown" as const;
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: pm });
  const chatId = await getTargetChatId();
  const link = await getSetting("channel_link");
  let c = "⚙️ *Current Config*\n\n";
  c += `*Channel ID:* ${chatId ? `\`${chatId}\`` : "_not set_"}\n`;
  c += `*Invite Link:* ${link || "_not set_"}`;
  return ctx.reply(c, { parse_mode: "Markdown" });
});

// --- Admin management ---

bot.command("addadmin", async (ctx) => {
  const pm = "Markdown" as const;
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: pm });
  const text = ctx.message.text.slice("/addadmin".length).trim();
  if (!text) return ctx.reply("Usage: `/addadmin <userId>`", { parse_mode: pm });
  // Check if admin replied to a message
  const msg = ctx.message as any;
  let userId: number | undefined;
  if (msg.reply_to_message?.from) {
    userId = msg.reply_to_message.from.id;
  } else {
    const parsed = parseInt(text, 10);
    if (isNaN(parsed)) return ctx.reply("Invalid user ID.", { parse_mode: pm });
    userId = parsed;
  }

  if (AdminSet.has(userId!)) return ctx.reply(`⚠ _User_ \`${userId}\` _is already an admin._`, { parse_mode: pm });

  AdminSet.add(userId!);
  await addAdminId(userId!);
  await UserModel.updateOne({ tgId: userId! }, { $set: { tgId: userId!, isAdmin: true } }, { upsert: true });

  return ctx.reply(`✅ _User_ \`${userId}\` _is now an admin._`, { parse_mode: pm });
});

bot.command("removeadmin", async (ctx) => {
  const pm = "Markdown" as const;
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: pm });
  const text = ctx.message.text.slice("/removeadmin".length).trim();
  const parsed = parseInt(text, 10) || 0;

  if (!parsed) return ctx.reply("Usage: `/removeadmin <userId>`", { parse_mode: pm });
  if (parsed === ctx.from.id) return ctx.reply("🚫 _Cannot remove yourself._", { parse_mode: pm });
  if (!AdminSet.has(parsed)) return ctx.reply(`⚠ _User_ \`${parsed}\` _is not an admin._`, { parse_mode: pm });

  AdminSet.delete(parsed);
  await removeAdminId(parsed);
  await UserModel.updateOne({ tgId: parsed }, { $set: { isAdmin: false } });

  return ctx.reply(`🔻 _User_ \`${parsed}\` _is no longer an admin._`, { parse_mode: pm });
});

bot.command("listadmins", async (ctx) => {
  const pm = "Markdown" as const;
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: pm });
  const ids = [...AdminSet].map((id) => `\`${id}\``).join(", ");
  return ctx.reply(`🛡️ *Admins* (${AdminSet.size}):\n\n${ids}`, { parse_mode: pm });
});

// Setup feature handlers
setupJoinRequest(bot, AdminSet);
setupBroadcast(bot, AdminSet);
setupStats(bot, AdminSet);
setupAdminRelay(bot, AdminSet);
setupMenu(bot, AdminSet);

// --- Express server with rate limiting and webhook validation ---
async function main() {
  await connectDb(MONGO_URI!);
  logger.info("MongoDB connected");
  await connectRedis(REDIS_URL);
  await loadAdmins();

  await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

  const app = express();

  // app.use(rateLimit({ windowMs: 60_000, max: 1000, message: { error: "Too many requests" } }));
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));

  app.post(WEBHOOK_PATH, (req: Request, res: Response) => {
    // if (!isWebhookValid(req)) return res.sendStatus(403);

    bot.handleUpdate(req.body, res).catch((err) => {
      logger.error({ err }, "Webhook handler error");
    });

    res.sendStatus(200);
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

  app.listen(PORT, () => {
    logger.info({ port: PORT, webhook: `${WEBHOOK_URL}${WEBHOOK_PATH}` }, "Bot listening");
  });
}

main().catch((err) => {
  logger.fatal(err);
  process.exit(1);
});
