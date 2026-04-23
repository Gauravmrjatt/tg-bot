import { Context, Telegraf, Markup } from "telegraf";
import {
  mapForwardedId, getForwardedAdminUser,
  getAdminState, clearAdminState, setAdminState,
  addAdminId, removeAdminId,
  banUser, unbanUser, isUserBanned,
  getRequiredChannels, addRequiredChannel,
  getSetting, setSetting,
} from "../utils/redis.js";
import { UserModel, BroadcastModel } from "../models/index.js";
import { setTargetChatId, setChannelLink, setWelcomeMessage, setFolderLink } from "../utils/settings.js";
import { runBroadcast } from "./broadcast.js";
import { adminMainKeyboard, cancelKeyboard, esc } from "../utils/format.js";

const PM = "Markdown" as const;

function adminPanelKeyboard(): any {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 Set Channels", "admin_set_channels")],
    [Markup.button.callback("💬 Set Welcome", "admin_set_welcome")],
    [Markup.button.callback("👁️ Preview Welcome", "admin_preview")],
    [Markup.button.callback("⬅️ Back to Menu", "admin_back")],
  ]);
}

async function showUserInfo(ctx: Context, targetUserId: number) {
  const user = await UserModel.findOne({ tgId: targetUserId });
  if (!user) {
    return ctx.reply(`👤 *User Info*\n\n*ID:* \`${targetUserId}\`\n\n⚠️ _User not found in database._`, { parse_mode: PM });
  }
  const fn = esc(user.firstName || "N/A");
  const ln = esc(user.lastName || "");
  const un = esc(user.username || "N/A");

  let out = "👤 *User Info*\n\n";
  out += `*Name:* ${fn}${ln ? " " + ln : ""}\n`;
  out += `*Username:* @${un}\n`;
  out += `*ID:* \`${targetUserId}\`\n`;
  out += `\n*Joined:* ${(user as any).joinedAt.toISOString().slice(0, 10)}\n`;
  const diff = Date.now() - (user as any).lastActiveAt.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) out += `*Last Active:* ${sec}s ago\n`;
  else if (sec < 3600) out += `*Last Active:* ${Math.floor(sec / 60)}m ago\n`;
  else if (sec < 86400) out += `*Last Active:* ${Math.floor(sec / 3600)}h ago\n`;
  else out += `*Last Active:* ${Math.floor(sec / 86400)}d ago\n`;
  out += `*Admin:* ${(user as any).isAdmin ? "✅" : "❌"}\n`;
  return ctx.reply(out, { parse_mode: PM });
}

export function setupAdminRelay(bot: Telegraf<Context>, adminSet: Set<number>) {
  bot.command("admin", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    
    await ctx.reply(
      "🛠️ *Admin Panel*",
      {
        parse_mode: PM,
        reply_markup: adminMainKeyboard().reply_markup
      }
    );
  });
  
  bot.action("admin_set_channels", async (ctx) => {
    const userId = ctx.callbackQuery.from.id;
    await ctx.answerCbQuery("Send channel username or ID");
    await setAdminState(userId, { action: "add_required_channel" });
    await ctx.editMessageText(
      "📝 *Send the channel username (e.g., @channelname) or numeric ID (e.g., -1001234567890)*",
      {
        parse_mode: PM,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel", "admin_cancel")]
        ]).reply_markup
      }
    );
  });

  bot.action("admin_set_welcome", async (ctx) => {
    const userId = ctx.callbackQuery.from.id;
    await ctx.answerCbQuery("Send welcome message text");
    await setAdminState(userId, { action: "set_welcome_message" });
    await ctx.editMessageText(
      "📝 *Send the welcome message text you want to use*",
      {
        parse_mode: PM,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel", "admin_cancel")]
        ]).reply_markup
      }
    );
  });

  bot.action("admin_preview", async (ctx) => {
    await ctx.answerCbQuery();
    const welcomeMsg = await getSetting("welcome_message") || "Welcome! Thanks for joining our channels.";
    await ctx.editMessageText(
      `👁️ *Current Welcome Message:*\n\n${welcomeMsg}`,
      {
        parse_mode: PM,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ Back", "admin_back")]
        ]).reply_markup
      }
    );
  });

  bot.action("admin_back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "🛠️ *Admin Panel*",
      {
        parse_mode: PM,
        reply_markup: adminPanelKeyboard().reply_markup
      }
    );
  });

  bot.action("admin_cancel", async (ctx) => {
    const userId = ctx.callbackQuery.from.id;
    await ctx.answerCbQuery("Cancelled");
    await clearAdminState(userId);
    await ctx.editMessageText(
      "🛠️ *Admin Panel*",
      {
        parse_mode: PM,
        reply_markup: adminPanelKeyboard().reply_markup
      }
    );
  });

  bot.on("message", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const adminState = await getAdminState(userId);
    if (!adminState) return next();

    const text = (ctx.message as any).text;
    if (!text) return next();

    await clearAdminState(userId);

    switch (adminState.action) {
      case "add_required_channel": {
        const channelInput = text.trim();
        if (!channelInput) {
          return ctx.reply("❌ Please provide a valid channel username or ID");
        }

        try {
          const channelsData = await getSetting("required_channels");
          let channels: { chatId: string; title?: string }[] = [];
          if (channelsData) {
            try {
              channels = JSON.parse(channelsData);
            } catch {
              channels = [];
            }
          }

          const exists = channels.some(c => c.chatId === channelInput);
          if (exists) {
            return ctx.reply(`⚠️ Channel ${channelInput} is already in the list`);
          }

          let title: string | undefined;
          try {
            const chat = await ctx.telegram.getChat(channelInput);
            title = (chat as any).title;
          } catch (err) {
            console.warn(`Could not fetch info for ${channelInput}:`, (err as Error).message);
          }

          channels.push({ chatId: channelInput, title });
          await setSetting("required_channels", JSON.stringify(channels));

          return ctx.reply(
            `✅ *Channel added!*\n\n${channelInput}${title ? ` (${title})` : ""}`,
            {
              parse_mode: PM,
              reply_markup: adminMainKeyboard().reply_markup
            }
          );
        } catch (err: any) {
          return ctx.reply(
            `❌ Failed to add channel: ${err.message}`,
            { parse_mode: "Markdown" }
          );
        }
      }

      case "set_welcome_message": {
        const welcomeText = text.trim();
        if (!welcomeText) {
          return ctx.reply("❌ Welcome message cannot be empty");
        }

        await setSetting("welcome_message", welcomeText);
        return ctx.reply(
          "✅ *Welcome message updated!*",
          {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup
          }
        );
      }

      default:
        return next();
    }
  });

  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();

    if (adminSet.has(ctx.from.id)) {
      const m = ctx.message as any;
      const replyTo = m.reply_to_message as { message_id?: number } | undefined | null;

      if (replyTo?.message_id) {
        let userId = await getForwardedAdminUser(ctx.chat.id, replyTo.message_id);
        if (!userId) {
          const fwdFrom = (replyTo as any).forward_from;
          if (fwdFrom?.id) userId = Number(fwdFrom.id);
        }
        if (userId) {
          const replyText = m.text || m.caption || "";

          if (replyText === "/info" || replyText.startsWith("/info ")) {
            await showUserInfo(ctx, userId);
            return;
          }
          if (replyText === "/ban" || replyText.startsWith("/ban ")) {
            if (adminSet.has(userId)) {
              return ctx.reply("🚫 _Cannot ban an admin._", { parse_mode: PM });
            }
            const alreadyBanned = await isUserBanned(userId);
            if (alreadyBanned) return ctx.reply(`⚠ _User_ \`${userId}\` _is already banned._`, { parse_mode: PM });
            await banUser(userId);
            await UserModel.updateOne({ tgId: userId }, { $set: { isBanned: true } }, { upsert: true });
            return ctx.reply(`🚫 _User_ \`${userId}\` _has been banned._`, { parse_mode: PM });
          }
          if (replyText === "/unban" || replyText.startsWith("/unban ")) {
            const banned = await isUserBanned(userId);
            if (!banned) return ctx.reply(`⚠ _User_ \`${userId}\` _is not banned._`, { parse_mode: PM });
            await unbanUser(userId);
            await UserModel.updateOne({ tgId: userId }, { $set: { isBanned: false } });
            return ctx.reply(`✅ _User_ \`${userId}\` _has been unbanned._`, { parse_mode: PM });
          }

          try {
            await bot.telegram.copyMessage(userId, ctx.chat.id, ctx.message.message_id);
            await ctx.reply(`✅ _Reply sent to user_ \`${userId}\``, { parse_mode: PM });
          } catch (err: any) {
            const errMsg = err.response?.description || err.message || "Unknown";
            await ctx.reply(`❌ _Failed:_ ${errMsg}`, { parse_mode: PM });
          }
          return;
        }
      }

      const state = await getAdminState(ctx.from.id);
      if (state) {
        await handleAdminFlow(bot, ctx, state, adminSet);
        return;
      }

      return next();
    }

    if (ctx.chat.type !== "private") return next();
    const m2 = ctx.message as any;
    if (m2.text && m2.text.startsWith("/")) return next();

    const userId = ctx.from.id;

    const banned = await isUserBanned(userId);
    if (banned) {
      await ctx.reply("🚫 _You are banned by admin. Your messages will not be delivered._", { parse_mode: PM });
      return;
    }

    const adminIdsArray = Array.from(adminSet);

    if (adminIdsArray.length === 0) {
      await ctx.reply("⚠️ _No admins are configured. Contact the bot owner._", { parse_mode: PM });
      return;
    }

    let successCount = 0;
    for (const adminId of adminIdsArray) {
      try {
        const fwd = await bot.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
        await mapForwardedId(adminId, fwd.message_id, userId);
        successCount++;
      } catch (e: any) {
        const errMsg = e?.response?.description || e?.message || "Unknown";
        console.error(`Failed to forward to admin ${adminId}: ${errMsg}`);
      }
    }

    if (successCount > 0) {
      await ctx.reply("✅ _Your message has been sent to admins._", { parse_mode: PM });
    } else {
      await ctx.reply("❌ _Failed to reach any admin. Try again later._", { parse_mode: PM });
    }
  });

  bot.command("info", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    let targetUserId: number | undefined;
    const m = ctx.message as any;

    if (m.reply_to_message?.message_id) {
      const fwdUserId = await getForwardedAdminUser(ctx.chat.id, m.reply_to_message.message_id);
      if (fwdUserId) {
        await showUserInfo(ctx, fwdUserId);
        return;
      }
      const fwdFrom = (m.reply_to_message as any).forward_from;
      if (fwdFrom?.id) {
        await showUserInfo(ctx, Number(fwdFrom.id));
        return;
      }
    }

    if (m.reply_to_message?.from) targetUserId = m.reply_to_message.from.id;
    if (!targetUserId) {
      const txt = (ctx as any).message.text.slice("/info".length).trim();
      if (txt) { const p = parseInt(txt, 10); if (!isNaN(p)) targetUserId = p; }
    }
    if (!targetUserId && ctx.chat.type === "private") targetUserId = ctx.chat.id;
    if (!targetUserId) return;

    await showUserInfo(ctx, targetUserId);
  });

  bot.command("bcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    const id = (ctx.message as any).text.slice("/bcast".length).trim();
    if (!id) return ctx.reply("Usage: `/bcast <id>`", { parse_mode: PM });
    const bc = await BroadcastModel.findOne({ messageId: id }).lean();
    if (!bc) return ctx.reply("Broadcast not found.", { parse_mode: PM });
    let msg = `📢 *Broadcast* \`${bc.messageId}\`\n`;
    msg += `*Status:* _${bc.status}_\n`;
    msg += `*Sent:* ${bc.sentAt.toISOString().slice(0, 19).replace("T", " ")}\n\n`;
    msg += `🟢 Delivered: *${bc.delivered}*\n🔴 Failed: *${bc.failed}*\n📊 Total: *${bc.totalTargeted}*`;
    return ctx.reply(msg, { parse_mode: PM });
  });

  async function handleAdminFlow(
    bot: Telegraf<Context>,
    ctx: Context,
    state: { action: string; data?: any },
    adminSet: Set<number>,
  ) {
    const text = (ctx.message as any).text || "";
    const cancel = text === "❌ Cancel";

    if (cancel || text === "/cancel") {
      await clearAdminState(ctx.from!.id);
      return ctx.reply("🔙 _Operation cancelled._", {
        parse_mode: PM,
        reply_markup: adminMainKeyboard().reply_markup,
      });
    }

    const uid = ctx.from!.id;

    switch (state.action) {
      case "add_admin": {
        const userId = parseInt(text, 10);
        if (isNaN(userId)) {
          return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        if (adminSet.has(userId)) {
          await clearAdminState(uid);
          return ctx.reply(`⚠ _User_ \`${userId}\` _is already an admin._`, {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        adminSet.add(userId);
        await addAdminId(userId);
        await UserModel.updateOne({ tgId: userId }, { $set: { tgId: userId, isAdmin: true } }, { upsert: true });
        await clearAdminState(uid);
        return ctx.reply(`✅ _User_ \`${userId}\` _is now an admin._`, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "remove_admin": {
        const userId = parseInt(text, 10);
        if (isNaN(userId) || userId === 0) {
          return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        if (userId === uid) {
          await clearAdminState(uid);
          return ctx.reply("🚫 _Cannot remove yourself._", {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        if (!adminSet.has(userId)) {
          await clearAdminState(uid);
          return ctx.reply(`⚠ _User_ \`${userId}\` _is not an admin._`, {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        adminSet.delete(userId);
        await removeAdminId(userId);
        await UserModel.updateOne({ tgId: userId }, { $set: { isAdmin: false } });
        await clearAdminState(uid);
        return ctx.reply(`���� _User_ \`${userId}\` _is no longer an admin._`, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "set_channel": {
        const chatId = parseInt(text, 10);
        if (isNaN(chatId)) {
          return ctx.reply("❌ Invalid chat ID. Send a numeric ID:", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        await setTargetChatId(chatId);
        await clearAdminState(uid);
        return ctx.reply(`✅ *Channel ID set to:* \`${chatId}\``, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

case "set_link": {
        if (!text.startsWith("https://t.me") && !text.startsWith("https://telegram.me")) {
          return ctx.reply("Invalid Telegram link.", {
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        await setChannelLink(text);
        await clearAdminState(uid);
        return ctx.reply("Channel invite link set.", {
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "set_welcome_msg": {
        await setWelcomeMessage(text);
        await clearAdminState(uid);
        return ctx.reply("Welcome message set.", {
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "set_folder_link": {
        if (!text.includes("t.me") && !text.includes("telegram.me")) {
          return ctx.reply("Invalid link.", {
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        await setFolderLink(text);
        await clearAdminState(uid);
        return ctx.reply("Folder link set.", {
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "broadcast": {
        const m = ctx.message as any;
        const data = state.data as { step?: string; text?: string; photoFileId?: string; buttonText?: string } | undefined;

        if (!data?.text && !data?.photoFileId) {
          const photo = m.photo?.[m.photo.length - 1];
          const caption = m.caption || "";

          if (photo) {
            await setAdminState(uid, { action: "broadcast", data: { step: "ask_button_text", text: caption, photoFileId: photo.file_id } });
            return ctx.reply("📸 *Photo received.*\n\n_Send button text (or type *skip* to send without a button):_", {
              parse_mode: PM,
              reply_markup: cancelKeyboard().reply_markup,
            });
          }

          if (!caption.trim()) {
            return ctx.reply("❌ Send a photo with caption, or type text message:", {
              parse_mode: PM,
              reply_markup: cancelKeyboard().reply_markup,
            });
          }

          await setAdminState(uid, { action: "broadcast", data: { step: "ask_button_text", text: caption } });
          return ctx.reply("📝 *Text received.*\n\n_Send button text (or type *skip* to send without a button):_", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }

        if (data?.step === "ask_button_text") {
          if (text.toLowerCase() === "skip") {
            await clearAdminState(uid);
            await runBroadcast(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId });
            return;
          }
          await setAdminState(uid, { action: "broadcast", data: { ...data, step: "ask_button_url", buttonText: text } });
          return ctx.reply("🔗 _Now send the button URL:_", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }

        if (data?.step === "ask_button_url") {
          if (text.toLowerCase() === "skip") {
            await clearAdminState(uid);
            await runBroadcast(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId, buttonText: data.buttonText });
            return;
          }
          if (!text.startsWith("http://") && !text.startsWith("https://")) {
            return ctx.reply("❌ Invalid URL. Must start with http:// or https://:", {
              parse_mode: PM,
              reply_markup: cancelKeyboard().reply_markup,
            });
          }
          await clearAdminState(uid);
          await runBroadcast(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId, buttonText: data.buttonText, buttonUrl: text });
          return;
        }

        await clearAdminState(uid);
        return ctx.reply("⚠ _Broadcast session expired. Please try again._", {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "bcast_status": {
        const bid = text.trim();
        await clearAdminState(uid);
        if (!bid) {
          return ctx.reply("❌ Invalid broadcast ID.", {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        const bc = await BroadcastModel.findOne({ messageId: bid }).lean();
        if (!bc) {
          return ctx.reply("Broadcast not found.", {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        let msg = `📢 *Broadcast* \`${bc.messageId}\`\n`;
        msg += `*Status:* _${bc.status}_\n`;
        msg += `*Sent:* ${bc.sentAt.toISOString().slice(0, 19).replace("T", " ")}\n\n`;
        msg += `🟢 Delivered: *${bc.delivered}*\n🔴 Failed: *${bc.failed}*\n📊 Total: *${bc.totalTargeted}*`;
        return ctx.reply(msg, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "ban_user": {
        const userId = parseInt(text, 10);
        if (isNaN(userId)) {
          return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        if (adminSet.has(userId)) {
          await clearAdminState(uid);
          return ctx.reply("🚫 _Cannot ban an admin._", {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        const alreadyBanned = await isUserBanned(userId);
        if (alreadyBanned) {
          await clearAdminState(uid);
          return ctx.reply(`⚠ _User_ \`${userId}\` _is already banned._`, {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        await banUser(userId);
        await UserModel.updateOne({ tgId: userId }, { $set: { isBanned: true } }, { upsert: true });
        await clearAdminState(uid);
        return ctx.reply(`🚫 _User_ \`${userId}\` _has been banned._`, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      case "unban_user": {
        const userId = parseInt(text, 10);
        if (isNaN(userId)) {
          return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
            parse_mode: PM,
            reply_markup: cancelKeyboard().reply_markup,
          });
        }
        const banned = await isUserBanned(userId);
        if (!banned) {
          await clearAdminState(uid);
          return ctx.reply(`⚠ _User_ \`${userId}\` _is not banned._`, {
            parse_mode: PM,
            reply_markup: adminMainKeyboard().reply_markup,
          });
        }
        await unbanUser(userId);
        await UserModel.updateOne({ tgId: userId }, { $set: { isBanned: false } });
        await clearAdminState(uid);
        return ctx.reply(`✅ _User_ \`${userId}\` _has been unbanned._`, {
          parse_mode: PM,
          reply_markup: adminMainKeyboard().reply_markup,
        });
      }

      default:
        await clearAdminState(uid);
    }
  }
}