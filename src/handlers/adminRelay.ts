import { Context, Telegraf } from "telegraf";
import {
  mapForwardedId, getForwardedAdminUser,
  getAdminState, clearAdminState,
  addAdminId, removeAdminId,
  banUser, unbanUser, isUserBanned,
} from "../utils/redis.js";
import { UserModel, BroadcastModel } from "../models/index.js";
import { setTargetChatId, setChannelLink } from "../utils/settings.js";
import { runBroadcast } from "./broadcast.js";
import { adminMainKeyboard, cancelKeyboard, esc } from "../utils/format.js";

const PM = "Markdown" as const;

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
  // --- User message forwarding to admins ---
  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();

    // Admin: check for reply to forwarded message OR interactive flow
    if (adminSet.has(ctx.from.id)) {
      const m = ctx.message as any;
      const replyTo = m.reply_to_message as { message_id?: number } | undefined | null;

      // First priority: admin replying to a forwarded message
      if (replyTo?.message_id) {
        const userId = await getForwardedAdminUser(ctx.chat.id, replyTo.message_id);
        if (userId) {
          const replyText = m.text || m.caption || "";

          // Check for /info, /ban, /unban commands
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

      // Second priority: interactive admin state flow
      const state = await getAdminState(ctx.from.id);
      if (state) {
        await handleAdminFlow(bot, ctx, state, adminSet);
        return;
      }

      // Admin sent a regular message with no state and no reply mapping — ignore
      return next();
    }

    // Non-admin: forward DMs to admins
    if (ctx.chat.type !== "private") return next();
    const m2 = ctx.message as any;
    if (m2.text && m2.text.startsWith("/")) return next();

    const userId = ctx.from.id;

    // Check if user is banned
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

  // --- /info command ---
  bot.command("info", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    let targetUserId: number | undefined;
    const m = ctx.message as any;

    // If replying to a forwarded message, resolve via Redis mapping
    if (m.reply_to_message?.message_id) {
      const fwdUserId = await getForwardedAdminUser(ctx.chat.id, m.reply_to_message.message_id);
      if (fwdUserId) {
        await showUserInfo(ctx, fwdUserId);
        return;
      }
    }

    // Fallback: use replied user ID or parse from command text
    if (m.reply_to_message?.from) targetUserId = m.reply_to_message.from.id;
    if (!targetUserId) {
      const txt = (ctx as any).message.text.slice("/info".length).trim();
      if (txt) { const p = parseInt(txt, 10); if (!isNaN(p)) targetUserId = p; }
    }
    if (!targetUserId && ctx.chat.type === "private") targetUserId = ctx.chat.id;
    if (!targetUserId) return;

    await showUserInfo(ctx, targetUserId);
  });

  // --- /bcast command ---
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
}

async function handleAdminFlow(
  bot: Telegraf<Context>,
  ctx: Context,
  state: { action: string },
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
      return ctx.reply(`🔻 _User_ \`${userId}\` _is no longer an admin._`, {
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
        return ctx.reply("❌ Invalid Telegram link. Example: \`https://t.me/+xxxxx\`:", {
          parse_mode: PM,
          reply_markup: cancelKeyboard().reply_markup,
        });
      }
      await setChannelLink(text);
      await clearAdminState(uid);
      return ctx.reply("✅ *Channel invite link set.*", {
        parse_mode: PM,
        reply_markup: adminMainKeyboard().reply_markup,
      });
    }

    case "broadcast": {
      if (!text.trim()) {
        return ctx.reply("❌ Message cannot be empty. Send your broadcast text:", {
          parse_mode: PM,
          reply_markup: cancelKeyboard().reply_markup,
        });
      }
      await clearAdminState(uid);
      await runBroadcast(bot, ctx, text);
      break;
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
