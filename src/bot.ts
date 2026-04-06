import { Telegraf, Context } from "telegraf";
import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { connectDb } from "./utils/db.js";
import { connectRedis } from "./utils/redis.js";
import { UserModel } from "./models/index.js";
import { setupJoinRequest } from "./handlers/joinRequest.js";
import { setupBroadcast } from "./handlers/broadcast.js";
import { setupStats } from "./handlers/stats.js";
import { setupAdminRelay } from "./handlers/adminRelay.js";

dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN not set");

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error("MONGO_URI not set");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const PORT = parseInt(process.env.SERVER_PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/tg-webhook";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL not set");

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const TARGET_CHAT_ID = parseInt(process.env.TARGET_CHAT_ID || "0", 10);
if (!TARGET_CHAT_ID) throw new Error("TARGET_CHAT_ID not set");

const bot = new Telegraf<Context>(TOKEN);

bot.start((ctx) => ctx.reply("Hey, I'm alive!"));
bot.help((ctx) => ctx.reply("Available commands:\n/rejoin — Get the channel invite link"));

bot.command("rejoin", async (ctx) => {
  const inviteLink = process.env.CHANNEL_INVITE_LINK;
  if (!inviteLink) return ctx.reply("Invite link is not configured.");
  return ctx.reply(`Here's the invite link: ${inviteLink}`);
});

// Track users who message the bot
bot.on("message", async (ctx, next) => {
  const user = ctx.from;
  await UserModel.findOneAndUpdate(
    { tgId: user.id },
    {
      tgId: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      isAdmin: ADMIN_IDS.includes(user.id),
      lastActiveAt: new Date(),
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return next();
});

// Setup feature handlers
setupJoinRequest(bot, ADMIN_IDS, TARGET_CHAT_ID);
setupBroadcast(bot, ADMIN_IDS);
setupStats(bot, ADMIN_IDS);
setupAdminRelay(bot, ADMIN_IDS);

// Auto-register webhook and start Express server
async function main() {
  await connectDb(MONGO_URI!);
  console.log("MongoDB connected");

  await connectRedis(REDIS_URL);

  await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

  const app = express();
  app.use(express.json());
  app.use(WEBHOOK_PATH, (req: Request, res: Response) => {
    bot.handleUpdate(req.body, res);
  });

  app.listen(PORT, () => {
    console.log(`Bot running on port ${PORT} with webhook ${WEBHOOK_URL}${WEBHOOK_PATH}`);
  });
}

main();
