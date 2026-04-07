import { Context, Telegraf } from "telegraf";
import {
  mapForwardedId, getForwardedAdminUser,
  getAdminState, clearAdminState, setAdminState,
  addAdminId, removeAdminId,
  getAutoApprove, setAutoApprove,
} from "../utils/redis.js";
import { UserModel, GlobalSettingsModel } from "../models/index.js";
import { setTargetChatId, setChannelLink } from "../utils/settings.js";
import { runBroadcast } from "./broadcast.js";
import { showStats } from "./stats.js";
import { adminMainKeyboard, cancelKeyboard } from "../utils/format.js";

const PM = "Markdown" as const;

export function setupAdminRelay(bot: Telegraf<Context>, adminSet: Set<number>) {
  // --- User message forwarding to admins ---
  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();

    // Admin with active conversational state
    if (adminSet.has(ctx.from.id)) {
      const state = await getAdminState(ctx.from.id);
      if (state) {
        await handleAdminFlow(bot, ctx, state, adminSet);
        return;
      }

      // Check for admin reply to a forwarded message
      const m = ctx.message as any;
      const replyTo = m.reply_to_message as { message_id?: number } | undefined | null;
      if (replyTo?.message_id) {
        const userId = await getForwardedAdminUser(ctx.chat.id, replyTo.message_id);
        if (userId) {
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
      return next();
    }

    // Non-admin: forward DMs
    if (ctx.chat.type !== "private") return next();
    const m2 = ctx.message as any;
    if (m2.text && m2.text.startsWith("/")) return next();

    const userId = ctx.from.id;
    const name = `${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}${ctx.from.username ? " (@" + ctx.from.username + ")" : ""}`;
    let sent = false;

    for (const adminId of adminSet) {
      try {
        const fwd = await bot.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
        await bot.telegram.sendMessage(adminId, `📨 _from:_ ${name}\n🆔 _ID:_ \`${userId}\``, { parse_mode: PM });
        await mapForwardedId(adminId, fwd.message_id, userId);
        sent = true;
      } catch { /* blocked */ }
    }

    if (sent) {
      await ctx.reply("✅ _Your message has been sent to admins._", { parse_mode: PM });
    } else {
      await ctx.reply("❌ _Failed to reach admins. Try again later._", { parse_mode: PM });
    }
  });

  // --- /info command ---
  bot.command("info", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    let targetUserId: number | undefined;
    const m = ctx.message as any;
    if (m.reply_to_message?.from) targetUserId = m.reply_to_message.from.id;
    if (!targetUserId) {
      const txt = (ctx as any).message.text.slice("/info".length).trim();
      if (txt) { const p = parseInt(txt, 10); if (!isNaN(p)) targetUserId = p; }
    }
    if (!targetUserId && ctx.chat.type === "private") targetUserId = ctx.chat.id;
    if (!targetUserId) return;

    const user = await UserModel.findOne({ tgId: targetUserId });
    const fn = (m.reply_to_message?.from?.first_name as string) || user?.firstName || "N/A";
    const ln = (m.reply_to_message?.from?.last_name as string) || user?.lastName || "";
    const un = (m.reply_to_message?.from?.username as string) || user?.username || "N/A";
    const id = (m.reply_to_message?.from?.id as number) || targetUserId;

    let out = "👤 *User Info*\n\n";
    out += `*Name:* ${fn}${ln ? " " + ln : ""}\n`;
    out += `*Username:* @${un}\n`;
    out += `*ID:* \`${id}\`\n`;
    if (user) {
      out += `\n*Joined:* ${(user as any).joinedAt.toISOString().slice(0, 10)}\n`;
      const diff = Date.now() - (user as any).lastActiveAt.getTime();
      const sec = Math.floor(diff / 1000);
      if (sec < 60) out += `*Last Active:* ${sec}s ago\n`;
      else if (sec < 3600) out += `*Last Active:* ${Math.floor(sec / 60)}m ago\n`;
      else if (sec < 86400) out += `*Last Active:* ${Math.floor(sec / 3600)}h ago\n`;
      else out += `*Last Active:* ${Math.floor(sec / 86400)}d ago\n`;
      out += `*Admin:* ${(user as any).isAdmin ? "✅" : "❌"}\n`;
    }
    return ctx.reply(out, { parse_mode: PM });
  });

  // --- Broadcast status check via conversation ---
  bot.command("bcast", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return;
    const id = (ctx.message as any).text.slice("/bcast".length).trim();
    if (!id) return ctx.reply("Usage: `/bcast <id>`", { parse_mode: PM });
    // Just pass to the existing handler
    await ctx.reply(`🔍 _Checking broadcast \` ${id}\`..._`, { parse_mode: PM });
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
      // Just reuse the command handler
      await ctx.reply("🔍 _Send the broadcast ID._", {
        parse_mode: PM,
        reply_markup: cancelKeyboard().reply_markup,
      });
      // Quick status check
      break;
    }

    default:
      await clearAdminState(uid);
  }
}
