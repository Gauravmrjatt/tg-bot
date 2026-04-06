import { Context, Telegraf } from "telegraf";
import { UserModel, JoinRequestModel, BroadcastModel } from "../models/index.js";

export function setupStats(bot: Telegraf<Context>, adminIds: number[]) {
  bot.command("stats", async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.reply("Admin only.");

    const totalUsers = await UserModel.countDocuments();
    const pendingRequests = await JoinRequestModel.countDocuments({ status: "pending" });
    const totalApproved = await JoinRequestModel.countDocuments({ status: "approved" });
    const totalDeclined = await JoinRequestModel.countDocuments({ status: "declined" });
    const broadcasts = await BroadcastModel.countDocuments();
    const recentBroadcasts = await BroadcastModel.find({}, { messageId: 1, delivered: 1, failed: 1, totalTargeted: 1, status: 1 })
      .sort({ sentAt: -1 })
      .limit(5);

    let msg = `Bot Stats\n\nUsers: ${totalUsers}\nJoin Requests: ${totalApproved} approved, ${totalDeclined} declined, ${pendingRequests} pending\nBroadcasts: ${broadcasts}\n`;

    if (recentBroadcasts.length > 0) {
      msg += `\nRecent broadcasts:\n`;
      for (const b of recentBroadcasts) {
        msg += `  ${b.messageId}: ${b.delivered}/${b.totalTargeted} delivered, ${b.failed} failed (${b.status})\n`;
      }
    }

    return ctx.reply(msg);
  });
}
