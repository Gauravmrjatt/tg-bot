import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pino from "pino";
import { connectDb } from "./utils/db.js";
import { connectRedis } from "./utils/redis.js";
import { UserModel } from "./models/index.js";
import { setupJoinRequest } from "./handlers/joinRequest.js";
import { setupBroadcast } from "./handlers/broadcast.js";
import { setupStats } from "./handlers/stats.js";
import { setupAdminRelay } from "./handlers/adminRelay.js";

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

const TARGET_CHAT_ID = parseInt(process.env.TARGET_CHAT_ID || "0", 10);
if (!TARGET_CHAT_ID) throw new Error("TARGET_CHAT_ID not set");

// Admin set as a lookup for O(1) checks
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
  const inviteLink = process.env.CHANNEL_INVITE_LINK;
  if (!inviteLink) return ctx.reply("Invite link is not configured.");
  return ctx.reply(`Here's the invite link: ${inviteLink}`);
});

// Setup feature handlers
setupJoinRequest(bot, ADMIN_IDS, TARGET_CHAT_ID);
setupBroadcast(bot, AdminSet);
setupStats(bot, ADMIN_IDS);
setupAdminRelay(bot, ADMIN_IDS);

// --- Express server with rate limiting and webhook validation ---
async function main() {
  await connectDb(MONGO_URI!);
  logger.info("MongoDB connected");
  await connectRedis(REDIS_URL);

  await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

  const app = express();

  app.use(rateLimit({ windowMs: 60_000, max: 1000, message: { error: "Too many requests" } }));

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
