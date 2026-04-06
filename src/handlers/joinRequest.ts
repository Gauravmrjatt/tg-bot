import { Context, Markup, Telegraf } from "telegraf";
import { UserModel, JoinRequestModel, GlobalSettingsModel } from "../models/index.js";
import { getAutoApprove, setAutoApprove, cachePendingRequest, getPendingRequest, removePendingRequest } from "../utils/redis.js";

export function setupJoinRequest(bot: Telegraf<Context>, adminIds: number[], targetChatId: number) {
  // Admin only — toggle global auto-approve (default OFF)
  bot.command("autoapprove", async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.reply("Admin only.");
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    // Persist to DB too
    const setting = await GlobalSettingsModel.findOne({ key: "auto_approve" });
    if (setting) {
      setting.value = !current;
      await setting.save();
    } else {
      await GlobalSettingsModel.create({ key: "auto_approve", value: !current });
    }
    return ctx.reply(`Auto-approve is now ${!current ? "ON" : "OFF"}. ${!current ? "Join requests will be approved automatically." : "Admins will review each request."}`);
  });

  bot.on("chat_join_request", async (ctx) => {
    const joinReq = ctx.chatJoinRequest!;
    const user = joinReq.from;
    const globalAuto = await getAutoApprove();

    // Upsert user record for tracking
    await UserModel.findOneAndUpdate(
      { tgId: user.id },
      {
        tgId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        isAdmin: adminIds.includes(user.id),
        lastActiveAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const name = `${user.first_name}${user.last_name ? " " + user.last_name : ""}${user.username ? " (@" + user.username + ")" : ""}`;

    if (globalAuto) {
      try {
        await bot.telegram.approveChatJoinRequest(joinReq.chat.id, user.id);
        await JoinRequestModel.create({
          chatId: joinReq.chat.id,
          userId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          autoApproved: true,
          approvedBy: 0,
          status: "approved",
          actionAt: new Date(),
        });
        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(adminId, `Auto-approved join request from ${name}`);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error("Auto-approve failed:", err);
      }
    } else {
      // Cache in Redis for instant approve/decline lookups
      await cachePendingRequest(user.id, {
        chatId: joinReq.chat.id,
        userId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      });

      const kb = Markup.inlineKeyboard([
        Markup.button.callback("Approve", `approve:${user.id}`),
        Markup.button.callback("Decline", `decline:${user.id}`),
      ]);
      for (const adminId of adminIds) {
        try {
          const msg = await bot.telegram.sendMessage(adminId, `Join request from ${name}\nChat ID: ${joinReq.chat.id}`, {
            reply_markup: kb.reply_markup,
          });
          await JoinRequestModel.create({
            chatId: joinReq.chat.id,
            userId: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            autoApproved: false,
            status: "pending",
            adminChatId: msg.chat.id,
            adminMessageId: msg.message_id,
          });
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  bot.action(/^approve:(\d+)$/, async (ctx) => {
    const userId = parseInt(ctx.match[1]!, 10);
    const cbUser = ctx.callbackQuery.from!;
    if (!adminIds.includes(cbUser.id)) return ctx.answerCbQuery("Not authorized.");

    // Fast path: Redis cache
    const cached = await getPendingRequest(userId);
    if (!cached) {
      // Fallback: DB
      const req = await JoinRequestModel.findOneAndUpdate(
        { userId, status: "pending" },
        { $set: { status: "approved", approvedBy: cbUser.id, actionAt: new Date() } },
      );
      if (!req) return ctx.answerCbQuery("Request no longer exists.");
      try {
        await bot.telegram.approveChatJoinRequest(req.chatId, userId);
        await ctx.editMessageText(`Approved join request from ${req.firstName}`);
        return ctx.answerCbQuery("Approved.");
      } catch {
        return ctx.answerCbQuery("Failed to approve.");
      }
    }

    await removePendingRequest(userId);
    await JoinRequestModel.updateOne({ userId }, { $set: { status: "pending", actionAt: new Date() } });
    try {
      await bot.telegram.approveChatJoinRequest(cached.chatId as number, userId);
      await ctx.editMessageText(`Approved join request from ${cached.firstName}`);
      return ctx.answerCbQuery("Approved.");
    } catch {
      return ctx.answerCbQuery("Failed to approve.");
    }
  });

  bot.action(/^decline:(\d+)$/, async (ctx) => {
    const userId = parseInt(ctx.match[1]!, 10);
    const cbUser = ctx.callbackQuery.from!;
    if (!adminIds.includes(cbUser.id)) return ctx.answerCbQuery("Not authorized.");

    const cached = await getPendingRequest(userId);
    if (!cached) {
      const req = await JoinRequestModel.findOneAndUpdate(
        { userId, status: "pending" },
        { $set: { status: "declined", approvedBy: cbUser.id, actionAt: new Date() } },
      );
      if (!req) return ctx.answerCbQuery("Request no longer exists.");
      try {
        await bot.telegram.declineChatJoinRequest(req.chatId, userId);
        await ctx.editMessageText(`Declined join request from ${req.firstName}`);
        return ctx.answerCbQuery("Declined.");
      } catch {
        return ctx.answerCbQuery("Failed to decline.");
      }
    }

    removePendingRequest(userId);
    await JoinRequestModel.updateOne({ userId }, { $set: { status: "declined", approvedBy: cbUser.id, actionAt: new Date() } });
    try {
      await bot.telegram.declineChatJoinRequest(cached.chatId as number, userId);
      await ctx.editMessageText(`Declined join request from ${cached.firstName}`);
      return ctx.answerCbQuery("Declined.");
    } catch {
      return ctx.answerCbQuery("Failed to decline.");
    }
  });
}
