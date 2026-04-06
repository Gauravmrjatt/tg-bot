import { Context, Telegraf } from "telegraf";
import { BroadcastModel, UserModel } from "../models/index.js";

// Build batches of `size` items for concurrent processing
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function setupBroadcast(bot: Telegraf<Context>, adminSet: Set<number>) {
  bot.command("broadcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
    const text = ctx.message.text.slice("/broadcast".length).trim();
    if (!text) return ctx.reply("Usage: /broadcast <message>");

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await BroadcastModel.create({ messageId: broadcastId, text });

    const users = await UserModel.find({}, { tgId: 1 }).lean();
    if (users.length === 0) return ctx.reply("No users to broadcast to.");

    await BroadcastModel.updateOne({ messageId: broadcastId }, { totalTargeted: users.length });
    await ctx.reply(`Broadcasting to ${users.length} users... ID: \`${broadcastId}\``, { parse_mode: "Markdown" });

    let delivered = 0;
    let failed = 0;
    let blocked = 0;

    // Send in batches of 50 concurrently (avoids Telegram rate limits)
    const batches = chunk(users, 50);
    const updateInterval = setInterval(async () => {
      await BroadcastModel.updateOne(
        { messageId: broadcastId },
        { $set: { delivered, failed: failed + blocked } }
      );
    }, 2000);

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (user) => {
          try {
            await bot.telegram.sendMessage(user.tgId, text);
            return "delivered" as const;
          } catch (err: any) {
            const lower = (err.response?.description || err.message || "").toLowerCase();
            if (lower.includes("blocked") || lower.includes("deactivated") || lower.includes("forbidden")) {
              return "blocked" as const;
            }
            return "failed" as const;
          }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "delivered") delivered++;
          else if (r.value === "blocked") blocked++;
          else failed++;
        } else {
          failed++; // should not happen but safety net
        }
      }
    }

    clearInterval(updateInterval);
    await BroadcastModel.updateOne(
      { messageId: broadcastId },
      { $set: { delivered, failed: failed + blocked, status: "completed" } }
    );

    return ctx.reply(
      `Broadcast complete!\nDelivered: ${delivered}\nFailed: ${failed}\nBlocked: ${blocked}\nTotal: ${users.length}`
    );
  });

  bot.command("bcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
    const id = ctx.message.text.slice("/bcast".length).trim();
    if (!id) return ctx.reply("Usage: /bcast <broadcastId>");

    const bc = await BroadcastModel.findOne({ messageId: id }).lean();
    if (!bc) return ctx.reply("Broadcast not found.");

    return ctx.reply(
      `Broadcast \`${bc.messageId}\` (${bc.status})\nSent: ${bc.sentAt.toISOString()}\nDelivered: ${bc.delivered}/${bc.totalTargeted}\nFailed: ${bc.failed}`,
      { parse_mode: "Markdown" }
    );
  });
}
