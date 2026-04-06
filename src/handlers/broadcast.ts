import { Context, Telegraf } from "telegraf";
import pLimit from "p-limit";
import { BroadcastModel, UserModel } from "../models/index.js";

const limit = pLimit(50); // up to 50 concurrent Telegram API requests

export function setupBroadcast(bot: Telegraf<Context>, adminSet: Set<number>) {
  bot.command("broadcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
    const text = ctx.message.text.slice("/broadcast".length).trim();
    if (!text) return ctx.reply("Usage: /broadcast <message>");

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const bc = await BroadcastModel.create({ messageId: broadcastId, text });

    const users = await UserModel.find({}, { tgId: 1, username: 1 }).lean();
    if (users.length === 0) return ctx.reply("No users to broadcast to.");

    await BroadcastModel.updateOne({ messageId: broadcastId }, { totalTargeted: users.length });
    await ctx.reply(`Broadcasting to ${users.length} users... ID: \`${broadcastId}\``, { parse_mode: "Markdown" });

    let delivered = 0;
    let failed = 0;
    let blocked = 0;

    // Process in batches of 50 concurrently
    const tasks = users.map((user) =>
      limit(async () => {
        try {
          await bot.telegram.sendMessage(user.tgId, text);
          delivered++;
        } catch (err: any) {
          const errMsg = err.response?.description || err.message || "";
          const lower = errMsg.toLowerCase();
          if (lower.includes("blocked") || lower.includes("deactivated") || lower.includes("forbidden")) {
            blocked++;
          } else {
            failed++;
          }
        }
      })
    );

    // Update progress every 100 messages
    let updateInterval = setInterval(async () => {
      await BroadcastModel.updateOne(
        { messageId: broadcastId },
        { $set: { delivered, failed: failed + blocked } }
      );
    }, 2000);

    await Promise.all(tasks);
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
