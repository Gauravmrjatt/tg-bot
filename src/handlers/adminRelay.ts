import { Context, Telegraf } from "telegraf";
import { cacheForwardedId, getForwardedUser } from "../utils/redis.js";

export function setupAdminRelay(bot: Telegraf<Context>, adminSet: Set<number>) {
  // Admin replies to a user: /reply <userId> <message>
  bot.command("reply", async (ctx) => {
    if (!ctx.from || !adminSet.has(ctx.from.id)) return ctx.reply("Admin only.");
    const text = ctx.message.text.slice("/reply".length).trim();
    if (!text) return ctx.reply("Usage: /reply <userId> <message>");
    const [userIdStr, ...rest] = text.split(" ");
    const userId = parseInt(userIdStr!, 10);
    if (isNaN(userId)) return ctx.reply("Usage: /reply <userId> <message> — userId must be a number.");
    const messageText = rest.join(" ");
    if (!messageText) return ctx.reply("Message cannot be empty.");

    try {
      await bot.telegram.sendMessage(userId, `Reply from admin:\n\n${messageText}`);
      await ctx.reply(`Message sent to user ${userId}.`);
    } catch (err: any) {
      const errMsg = err.response?.description || err.message || "Unknown error";
      await ctx.reply(`Failed to send: ${errMsg}`);
    }
  });

  // Handle both admin reply-to-forwarded and user DM forwarding in one middleware
  bot.on("text", async (ctx, next) => {
    if (!ctx.from) return next();

    const textMsg = ctx.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = textMsg as any;
    const text = textMsg.text;

    // If admin is replying to a message we forwarded, extract user ID and reply
    if (adminSet.has(ctx.from.id)) {
      const replyTo = msg.reply_to_message as { message_id: number } | undefined | null;
      if (replyTo && text && !text.startsWith("/")) {
        const userId = await getForwardedUser(replyTo.message_id);
        if (userId) {
          try {
            await bot.telegram.sendMessage(userId, `Reply from admin:\n\n${text}`);
            await ctx.reply(`Reply sent to user ${userId}.`);
          } catch (err: any) {
            const errMsg = err.response?.description || err.message || "Unknown error";
            await ctx.reply(`Failed to send: ${errMsg}`);
          }
          return;
        }
      }
      return next();
    }

    // User DM forward (non-admin, non-command, private chat)
    if (ctx.chat.type !== "private") return next();
    if (!text || text.startsWith("/")) return next();

    const userId = ctx.from.id;
    const name = `${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}${ctx.from.username ? " (@" + ctx.from.username + ")" : ""}`;
    const forwardMsg = `Message from ${name} (ID: ${userId})\n\n${text}`;

    let sentMsg: { message_id: number } | null = null;
    let sent = 0;
    for (const adminId of adminSet) {
      try {
        const m = await bot.telegram.sendMessage(adminId, forwardMsg);
        sent++;
        sentMsg = m;
      } catch {
        /* ignore */
      }
    }

    if (sent > 0 && sentMsg) {
      await cacheForwardedId(sentMsg.message_id, userId);
      await ctx.reply(`Your message has been sent to our admins. We will reply as soon as possible.`);
    } else {
      await ctx.reply(`Failed to reach any admin. Please try again later.`);
    }
  });
}
