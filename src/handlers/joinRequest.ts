import { Context, Markup, Telegraf } from "telegraf";
import { UserModel, JoinRequestModel, GlobalSettingsModel } from "../models/index.js";
import { getAutoApprove, setAutoApprove, cachePendingRequest, getPendingRequest, removePendingRequest } from "../utils/redis.js";
import { getTargetChatId } from "../utils/settings.js";
import { esc } from "../utils/format.js";

export function setupJoinRequest(bot: Telegraf<Context>, adminSet: Set<number>) {
  // Admin only — toggle global auto-approve (default OFF)
  bot.command("autoapprove", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
    const current = await getAutoApprove();
    await setAutoApprove(!current);
    const setting = await GlobalSettingsModel.findOne({ key: "auto_approve" });
    if (setting) {
      setting.value = !current;
      await setting.save();
    } else {
      await GlobalSettingsModel.create({ key: "auto_approve", value: !current });
    }
    return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}_.\n${!current ? "✅ Join requests will be approved automatically." : "🛡️ Admins will review each request."}`, { parse_mode: "Markdown" });
  });

  bot.on("chat_join_request", async (ctx) => {
    const joinReq = ctx.chatJoinRequest!;
    const user = joinReq.from;
    const globalAuto = await getAutoApprove();
    const targetChatId = await getTargetChatId();

    await UserModel.updateOne(
      { tgId: user.id },
      {
        $set: {
          tgId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          isAdmin: adminSet.has(user.id),
          lastActiveAt: new Date(),
        },
      },
      { upsert: true },
    );

    const safeName = esc(`${user.first_name}${user.last_name ? " " + user.last_name : ""}${user.username ? " (@" + user.username + ")" : ""}`);

    if (globalAuto) {
      try {
        await bot.telegram.approveChatJoinRequest(joinReq.chat.id, user.id);
        await JoinRequestModel.create({
          chatId: targetChatId ?? joinReq.chat.id,
          userId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          autoApproved: true,
          approvedBy: 0,
          status: "approved",
          actionAt: new Date(),
        });
        for (const adminId of adminSet) {
          try {
            await bot.telegram.sendMessage(adminId, `✅ *Auto-approved* join request from _${safeName}_`, { parse_mode: "Markdown" });
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error("Auto-approve failed:", err);
      }
    } else {
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
      for (const adminId of adminSet) {
        try {
          const msg = await bot.telegram.sendMessage(adminId, `📨 *Join Request*\n\n*Name:* _${safeName}_\n*Chat ID:* \`${joinReq.chat.id}\``, {
            parse_mode: "Markdown",
            reply_markup: kb.reply_markup,
          });
          await JoinRequestModel.create({
            chatId: targetChatId ?? joinReq.chat.id,
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
    if (!adminSet.has(cbUser.id)) return ctx.answerCbQuery("Not authorized.");

    const cached = await getPendingRequest(userId);
    if (!cached) {
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
    await JoinRequestModel.updateOne({ userId }, { $set: { status: "approved", approvedBy: cbUser.id, actionAt: new Date() } });
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
    if (!adminSet.has(cbUser.id)) return ctx.answerCbQuery("Not authorized.");

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

    await removePendingRequest(userId);
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
