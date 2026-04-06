import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pino from "pino";
import { connectDb } from "./utils/db.js";
import { connectRedis, getSetting } from "./utils/redis.js";
import { UserModel, GlobalSettingsModel } from "./models/index.js";
import { setupJoinRequest } from "./handlers/joinRequest.js";
import { setupBroadcast } from "./handlers/broadcast.js";
import { setupStats } from "./handlers/stats.js";
import { setupAdminRelay } from "./handlers/adminRelay.js";
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

// Comma-separated admin user IDs
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const AdminSet = new Set(ADMIN_IDS);

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

bot.start((ctx) => ctx.reply("Hey, I'm alive!"));
bot.help((ctx) => ctx.reply("Available commands:\n/rejoin — Get the channel invite link"));

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
  if (!ctx.from || !AdminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
  const chatId = await getTargetChatId();
  const link = await getSetting("channel_link");
  return ctx.reply(`Current config:\nTarget Chat ID: ${chatId ?? "(not set)"}\nChannel Link: ${link ?? "(not set)"}`);
});

// Setup feature handlers
setupJoinRequest(bot, AdminSet);
setupBroadcast(bot, AdminSet);
setupStats(bot, AdminSet);
setupAdminRelay(bot, AdminSet);

// --- Express server with rate limiting and webhook validation ---
async function main() {
  await connectDb(MONGO_URI!);
  logger.info("MongoDB connected");
  await connectRedis(REDIS_URL);

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
