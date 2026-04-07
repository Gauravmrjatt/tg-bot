import { Context, Telegraf } from "telegraf";
import { UserModel, JoinRequestModel, BroadcastModel } from "../models/index.js";

export async function showStats(ctx: Context): Promise<void> {
  const [totalUsers, joinStats, broadcasts] = await Promise.all([
    UserModel.countDocuments(),
    JoinRequestModel.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    BroadcastModel.countDocuments(),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of joinStats) {
    statusMap[s._id] = s.count;
  }

  const pendingRequests = statusMap["pending"] || 0;
  const totalApproved = statusMap["approved"] || 0;
  const totalDeclined = statusMap["declined"] || 0;

  const recentBroadcasts = await BroadcastModel.find({}, { messageId: 1, delivered: 1, failed: 1, totalTargeted: 1, status: 1 })
    .sort({ sentAt: -1 })
    .limit(5);

  let msg = `📊 *Bot Stats*\n\n`;
  msg += `*Users:* ${totalUsers}\n`;
  msg += `*Join Requests:* ${totalApproved} approved, ${totalDeclined} declined, ${pendingRequests} pending\n`;
  msg += `*Broadcasts:* ${broadcasts}\n`;

  if (recentBroadcasts.length > 0) {
    msg += `\n*Recent broadcasts:*\n`;
    for (const b of recentBroadcasts) {
      msg += `  \`${b.messageId}\`: ${b.delivered}/${b.totalTargeted} delivered, ${b.failed} failed (${b.status})\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: "Markdown" });
}

export function setupStats(bot: Telegraf<Context>, adminSet: Set<number>) {
  bot.command("stats", showStats);
}
