import { Context, Telegraf } from "telegraf";
import { BroadcastModel, UserModel } from "../models/index.js";

const BATCH_SIZE = 100; // Fetch 100 users per DB query
const BATCH_DELAY_MS = 1000; // wait between batches
const CONCURRENT = 25; // max concurrent sends within a batch

// Process an array with limited concurrency
async function processConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

// Telegram API helper: respects 429 rate limits
async function sendMessageWithRetry(
  bot: Telegraf<Context>,
  userId: number,
  text: string,
  maxRetries = 2,
): Promise<"delivered" | "failed" | "blocked"> {
  let retries = 0;

  while (true) {
    try {
      await bot.telegram.sendMessage(userId, text);
      return "delivered";
    } catch (err: any) {
      const desc = err.response?.description || err.message || "";
      const lower = desc.toLowerCase();

      // Handle 429 rate limiting
      if (lower.includes("too many requests") || lower.includes("429")) {
        const match = desc.match(/retry after[: ]+(\d+)/i);
        const retryAfter = match ? parseInt(match[1], 10) : 5;
        const delay = Math.min(retryAfter * 1000, 30000);

        if (retries < maxRetries) {
          retries++;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        // Max retries hit — count as failed
        return "failed";
      }

      if (lower.includes("blocked") || lower.includes("deactivated") || lower.includes("forbidden")) {
        return "blocked";
      }
      return "failed";
    }
  }
}

// Shared broadcast state
let activeBroadcast: { broadcastId: string; delivered: number; failed: number; blocked: number } | null = null;

export async function runBroadcast(bot: Telegraf<Context>, ctx: Context, text: string): Promise<void> {
  const adminSet = (bot as any).__adminSet as Set<number>;
  if (!ctx.from || !adminSet.has(ctx.from.id)) {
    await ctx.reply("🛡️ _Admin only._", { parse_mode: "Markdown" });
    return;
  }
  if (!text.trim()) {
    await ctx.reply("❌ _Message cannot be empty._", { parse_mode: "Markdown" });
    return;
  }
  if (activeBroadcast) {
    await ctx.reply("⚠ _A broadcast is already in progress. Wait for it to finish._", { parse_mode: "Markdown" });
    return;
  }

  const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await BroadcastModel.create({ messageId: broadcastId, text });

  const totalUsers = await UserModel.countDocuments();
  if (totalUsers === 0) {
    await ctx.reply("📢 _No users to broadcast to._", { parse_mode: "Markdown" });
    return;
  }

  await BroadcastModel.updateOne({ messageId: broadcastId }, { totalTargeted: totalUsers });

  // Track progress
  let delivered = 0, failed = 0, blocked = 0;
  activeBroadcast = { broadcastId, delivered: 0, failed: 0, blocked: 0 };

  await ctx.reply(`📢 *Broadcasting* to ${totalUsers} users...\n\n🆔 ID: \`${broadcastId}\``, { parse_mode: "Markdown" });

  let processed = 0;
  let lastId: string | undefined;

  while (processed < totalUsers) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const users = await UserModel.find(query, { tgId: 1 })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (users.length === 0) break;
    lastId = String(users[users.length - 1]._id);

    const results = await processConcurrent(
      users,
      CONCURRENT,
      async (user) => {
        return sendMessageWithRetry(bot, user.tgId, text);
      },
    );

    for (const r of results) {
      if (r === "delivered") activeBroadcast.delivered++;
      else if (r === "blocked") activeBroadcast.blocked++;
      else activeBroadcast.failed++;
    }

    processed += users.length;

    if (processed % 200 === 0 || processed >= totalUsers) {
      await BroadcastModel.updateOne(
        { messageId: broadcastId },
        { $set: { delivered: activeBroadcast.delivered, failed: activeBroadcast.failed + activeBroadcast.blocked } },
      );
    }

    if (processed < totalUsers) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const { delivered: d, failed: f, blocked: b } = activeBroadcast;
  await BroadcastModel.updateOne(
    { messageId: broadcastId },
    { $set: { delivered: d, failed: f + b, status: "completed" } },
  );
  activeBroadcast = null;

  await ctx.reply(
    `📢 *Broadcast Complete*\n\n🟢 Delivered: *${d}*\n🔴 Failed: *${f}*\n🚫 Blocked: *${b}*\n📊 Total: *${totalUsers}*`,
    { parse_mode: "Markdown" },
  );
}

export function setupBroadcast(bot: Telegraf<Context>, adminSet: Set<number>) {
  bot.command("broadcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: "Markdown" });
    const text = ctx.message.text.slice("/broadcast".length).trim();
    if (!text) return ctx.reply("Usage: `/broadcast <message>`", { parse_mode: "Markdown" });
    return runBroadcast(bot, ctx, text);
  });

  bot.command("bcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: "Markdown" });
    const id = ctx.message.text.slice("/bcast".length).trim();
    if (!id) return ctx.reply("Usage: `/bcast <id>`", { parse_mode: "Markdown" });

    const bc = await BroadcastModel.findOne({ messageId: id }).lean();
    if (!bc) return ctx.reply("Broadcast not found.");

    let msg = `📢 *Broadcast* \`${bc.messageId}\`\n`;
    msg += `*Status:* _${bc.status}_\n`;
    msg += `*Sent:* ${bc.sentAt.toISOString().slice(0, 19).replace("T", " ")}\n\n`;
    msg += `🟢 Delivered: *${bc.delivered}*\n🔴 Failed: *${bc.failed}*\n📊 Total: *${bc.totalTargeted}*`;
    return ctx.reply(msg, { parse_mode: "Markdown" });
  });
}
