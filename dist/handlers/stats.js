"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showStats = showStats;
exports.setupStats = setupStats;
const index_js_1 = require("../models/index.js");
async function showStats(ctx) {
    const totalUsers = await index_js_1.UserModel.countDocuments();
    const pendingRequests = await index_js_1.JoinRequestModel.countDocuments({ status: "pending" });
    const totalApproved = await index_js_1.JoinRequestModel.countDocuments({ status: "approved" });
    const totalDeclined = await index_js_1.JoinRequestModel.countDocuments({ status: "declined" });
    const broadcasts = await index_js_1.BroadcastModel.countDocuments();
    const recentBroadcasts = await index_js_1.BroadcastModel.find({}, { messageId: 1, delivered: 1, failed: 1, totalTargeted: 1, status: 1 })
        .sort({ sentAt: -1 })
        .limit(5);
    let msg = `Bot Stats\n\nUsers: ${totalUsers}\nJoin Requests: ${totalApproved} approved, ${totalDeclined} declined, ${pendingRequests} pending\nBroadcasts: ${broadcasts}\n`;
    if (recentBroadcasts.length > 0) {
        msg += `\nRecent broadcasts:\n`;
        for (const b of recentBroadcasts) {
            msg += `  ${b.messageId}: ${b.delivered}/${b.totalTargeted} delivered, ${b.failed} failed (${b.status})\n`;
        }
    }
    await ctx.reply(msg);
}
function setupStats(bot, adminSet) {
    bot.command("stats", showStats);
}
