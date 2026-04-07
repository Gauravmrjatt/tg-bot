import { Context, Telegraf } from "telegraf";
import { BroadcastModel, UserModel } from "../models/index.js";

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;
const CONCURRENT = 25;

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

type BroadcastPayload = {
  text: string;
  photoFileId?: string;
  buttonText?: string;
  buttonUrl?: string;
};

async function sendBroadcastWithRetry(
  bot: Telegraf<Context>,
  userId: number,
  payload: BroadcastPayload,
  maxRetries = 2,
): Promise<"delivered" | "failed" | "blocked"> {
  let retries = 0;

  while (true) {
    try {
      if (payload.photoFileId) {
        const kb = payload.buttonText && payload.buttonUrl
          ? { inline_keyboard: [[{ text: payload.buttonText, url: payload.buttonUrl }]] }
          : undefined;
        await bot.telegram.sendPhoto(userId, payload.photoFileId, {
          caption: payload.text || undefined,
          reply_markup: kb,
        });
      } else {
        const kb = payload.buttonText && payload.buttonUrl
          ? { inline_keyboard: [[{ text: payload.buttonText, url: payload.buttonUrl }]] }
          : undefined;
        await bot.telegram.sendMessage(userId, payload.text, { reply_markup: kb });
      }
      return "delivered";
    } catch (err: any) {
      const desc = err.response?.description || err.message || "";
      const lower = desc.toLowerCase();

      if (lower.includes("too many requests") || lower.includes("429")) {
        const match = desc.match(/retry after[: ]+(\d+)/i);
        const retryAfter = match ? parseInt(match[1], 10) : 5;
        const delay = Math.min(retryAfter * 1000, 30000);

        if (retries < maxRetries) {
          retries++;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return "failed";
      }

      if (lower.includes("blocked") || lower.includes("deactivated") || lower.includes("forbidden")) {
        return "blocked";
      }
      return "failed";
    }
  }
}

let activeBroadcast: { broadcastId: string; delivered: number; failed: number; blocked: number } | null = null;

export async function runBroadcast(
  bot: Telegraf<Context>,
  ctx: Context,
  payload: BroadcastPayload,
): Promise<void> {
  const adminSet = (bot as any).__adminSet as Set<number>;
  if (!ctx.from || !adminSet.has(ctx.from.id)) {
    await ctx.reply("🛡️ _Admin only._", { parse_mode: "Markdown" });
    return;
  }
  if (!payload.text.trim() && !payload.photoFileId) {
    await ctx.reply("❌ _Message cannot be empty._", { parse_mode: "Markdown" });
    return;
  }
  if (activeBroadcast) {
    await ctx.reply("⚠ _A broadcast is already in progress. Wait for it to finish._", { parse_mode: "Markdown" });
    return;
  }

  const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await BroadcastModel.create({
    messageId: broadcastId,
    text: payload.text,
    photoFileId: payload.photoFileId,
    buttonText: payload.buttonText,
    buttonUrl: payload.buttonUrl,
  });

  const totalUsers = await UserModel.countDocuments();
  if (totalUsers === 0) {
    await ctx.reply("📢 _No users to broadcast to._", { parse_mode: "Markdown" });
    return;
  }

  await BroadcastModel.updateOne({ messageId: broadcastId }, { totalTargeted: totalUsers });

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
      async (user) => sendBroadcastWithRetry(bot, user.tgId, payload),
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
    if (bc.buttonText && bc.buttonUrl) {
      msg += `\n🔗 *Button:* [${bc.buttonText}](${bc.buttonUrl})`;
    }
    return ctx.reply(msg, { parse_mode: "Markdown" });
  });
}
