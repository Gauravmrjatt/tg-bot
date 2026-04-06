import { Context, Telegraf } from "telegraf";
import { BroadcastModel, UserModel } from "../models/index.js";

export function setupBroadcast(bot: Telegraf<Context>, adminIds: number[]) {
  bot.command("broadcast", async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.reply("Admin only.");
    const text = ctx.message.text.slice("/broadcast".length).trim();
    if (!text) return ctx.reply("Usage: /broadcast <message>");

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await BroadcastModel.create({ messageId: broadcastId, text });

    const users = await UserModel.find({}, { tgId: 1 });
    if (users.length === 0) return ctx.reply("No users to broadcast to.");

    await BroadcastModel.updateOne({ messageId: broadcastId }, { totalTargeted: users.length });
    await ctx.reply(`Broadcasting to ${users.length} users... ID: \`${broadcastId}\``, { parse_mode: "Markdown" });

    let delivered = 0;
    let failed = 0;
    let blocked = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.tgId, text);
        delivered++;
      } catch (err: any) {
        const errMsg = err.response?.description || err.message || "Unknown";
        if (errMsg.toLowerCase().includes("blocked") || errMsg.toLowerCase().includes("deactivated")) {
          blocked++;
        } else {
          failed++;
        }
      }
    }

    await BroadcastModel.updateOne(
      { messageId: broadcastId },
      { $set: { delivered, failed: failed + blocked, status: "completed" } }
    );

    return ctx.reply(
      `Broadcast complete!\nDelivered: ${delivered}\nFailed: ${failed}\nBlocked: ${blocked}\nTotal: ${users.length}`
    );
  });

  bot.command("bcast", async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.reply("Admin only.");
    const id = ctx.message.text.slice("/bcast".length).trim();
    if (!id) return ctx.reply("Usage: /bcast <broadcastId>");

    const bc = await BroadcastModel.findOne({ messageId: id });
    if (!bc) return ctx.reply("Broadcast not found.");

    return ctx.reply(
      `Broadcast \`${bc.messageId}\` (${bc.status})\nSent: ${bc.sentAt.toISOString()}\nDelivered: ${bc.delivered}/${bc.totalTargeted}\nFailed: ${bc.failed}`,
      { parse_mode: "Markdown" }
    );
  });
}
