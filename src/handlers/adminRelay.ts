import { Context, Telegraf } from "telegraf";
import { cacheForwardedId, getForwardedUser } from "../utils/redis.js";
import { UserModel } from "../models/index.js";

const PM = "Markdown" as const;

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function setupAdminRelay(bot: Telegraf<Context>, adminSet: Set<number>) {
  // --- /reply <userId> <message> (admin) ---
  bot.command("reply", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: PM });
    const text = ctx.message.text.slice("/reply".length).trim();
    if (!text) return ctx.reply("Usage: `/reply <userId> <message>`", { parse_mode: PM });
    const [uid, ...rest] = text.split(" ");
    const userId = parseInt(uid!, 10);
    if (isNaN(userId)) return ctx.reply("Usage: `/reply <userId> <message>`", { parse_mode: PM });
    const msg = rest.join(" ");
    if (!msg) return ctx.reply("Message cannot be empty.");
    try {
      await bot.telegram.sendMessage(userId, `🛡️ *Reply from admin:*\n\n${msg}`, { parse_mode: PM });
      await ctx.reply(`✅ _Message sent to user_ \`${userId}\``, { parse_mode: PM });
    } catch (err: any) {
      const errMsg = err.response?.description || err.message || "Unknown";
      await ctx.reply(`❌ _Failed:_ ${errMsg}`, { parse_mode: PM });
    }
  });

  // --- /info (admin) — show user details ---
  bot.command("info", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("🛡️ _Admin only._", { parse_mode: PM });

    const m = ctx.message as any;
    let targetUserId: number | undefined;

    // Reply to a forwarded message
    if (m.reply_to_message?.from) {
      targetUserId = m.reply_to_message.from.id;
    }
    // /info <userId>
    if (!targetUserId) {
      const txt = ctx.message.text.slice("/info".length).trim();
      if (txt) {
        const p = parseInt(txt, 10);
        if (!isNaN(p)) targetUserId = p;
      }
    }
    // In DM with non-admin, show self
    if (!targetUserId && ctx.chat.type === "private") {
      targetUserId = ctx.chat.id;
    }
    if (!targetUserId) return ctx.reply("Usage: `/info` in a DM, `/info <userId>`, or reply with `/info`", { parse_mode: PM });

    const user = await UserModel.findOne({ tgId: targetUserId });
    const fn = (m.reply_to_message?.from?.first_name as string) || (user as any)?.firstName || "N/A";
    const ln = (m.reply_to_message?.from?.last_name as string) || (user as any)?.lastName || "";
    const un = (m.reply_to_message?.from?.username as string) || (user as any)?.username || "N/A";
    const id = (m.reply_to_message?.from?.id as number) || targetUserId;

    let out = "👤 *User Info*\n\n";
    out += `*Name:* ${fn}${ln ? " " + ln : ""}\n`;
    out += `*Username:* @${un}\n`;
    out += `*ID:* \`${id}\`\n`;
    if (user) {
      out += `\n*Joined:* ${(user as any).joinedAt.toISOString().slice(0, 10)}\n`;
      out += `*Last Active:* ${(user as any).lastActiveAt ? timeAgo((user as any).lastActiveAt) : "N/A"}\n`;
      out += `*Admin:* ${(user as any).isAdmin ? "✅" : "❌"}\n`;
    }
    return ctx.reply(out, { parse_mode: PM });
  });

  // --- Single message handler: forwards user messages to admins, handles admin replies ---
  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();

    const isAdmin = adminSet.has(ctx.from.id);

    // Admin: check if replying to a forwarded message
    if (isAdmin) {
      const m = ctx.message as any;
      const replyTo = m.reply_to_message as { message_id: number } | undefined | null;
      if (replyTo) {
        const userId = await getForwardedUser(replyTo.message_id);
        if (userId) {
          try {
            // Forward admin's response (preserves text, photos, docs, etc.)
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

    // Non-admin: forward from DM to admins
    if (ctx.chat.type !== "private") return next();
    // Skip commands
    const m = ctx.message as any;
    if (m.text && m.text.startsWith("/")) return next();

    const userId = ctx.from.id;
    const name = `${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}${ctx.from.username ? " (@" + ctx.from.username + ")" : ""}`;

    let sentMsg: { message_id: number } | null = null;
    let sent = 0;

    for (const adminId of adminSet) {
      try {
        // Forward the raw message — preserves photo, doc, video, audio, sticker, poll, contact, location, etc.
        const fwd = await bot.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
        // Add context info
        await bot.telegram.sendMessage(adminId, `📨 _from:_ ${name}\n🆔 _ID:_ \`${userId}\``, { parse_mode: PM });
        sent++;
        sentMsg = fwd;
      } catch {
        /* ignore */
      }
    }

    if (sent > 0 && sentMsg) {
      await cacheForwardedId(sentMsg.message_id, userId);
      await ctx.reply("✅ _Your message has been sent to admins._", { parse_mode: PM });
    } else {
      await ctx.reply("❌ _Failed to reach admins. Try again later._", { parse_mode: PM });
    }
  });
}
