import { Context, Telegraf } from "telegraf";

export function setupAdminRelay(bot: Telegraf<Context>, adminIds: number[]) {
  // Admin replies to a user: /reply <userId> <message>
  bot.command("reply", async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.reply("Admin only.");

    const text = ctx.message.text.slice("/reply".length).trim();
    if (!text) return ctx.reply("Usage: /reply <userId> <message>");

    const parts = text.split(" ");
    const userId = parseInt(parts[0]!, 10);
    if (isNaN(userId)) return ctx.reply("Usage: /reply <userId> <message> — userId must be a number.");

    const messageText = parts.slice(1).join(" ");
    if (!messageText) return ctx.reply("Message cannot be empty.");

    try {
      await bot.telegram.sendMessage(userId, `Reply from admin:\n\n${messageText}`);
      await ctx.reply(`Message sent to user ${userId}.`);
    } catch (err: any) {
      const errMsg = err.response?.description || err.message || "Unknown error";
      await ctx.reply(`Failed to send: ${errMsg}`);
    }
  });

  // Forward user messages to admins (non-command messages from DMs)
  bot.on("text", async (ctx) => {
    if (ctx.from && adminIds.includes(ctx.from.id)) return; // skip admin messages
    if (ctx.chat.type !== "private") return; // only DMs
    // Skip commands
    const text = ctx.message.text;
    if (text?.startsWith("/")) return;

    const userId = ctx.from.id;
    const name = `${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}${ctx.from.username ? " (@" + ctx.from.username + ")" : ""}`;

    const msg = `Message from ${name} (ID: ${userId})\n\n${text}`;

    let sent = 0;
    for (const adminId of adminIds) {
      try {
        await bot.telegram.sendMessage(adminId, msg);
        sent++;
      } catch {
        /* ignore individual admin failure */
      }
    }

    if (sent > 0) {
      await ctx.reply(`Your message has been sent to our admins. We will reply as soon as possible.`);
    } else {
      await ctx.reply(`Failed to reach any admin. Please try again later.`);
    }
  });
}
