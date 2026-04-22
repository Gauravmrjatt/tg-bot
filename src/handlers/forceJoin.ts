import { Telegraf, Context, Markup } from "telegraf";
import {
  checkAllChannels,
  getRequiredChannels,
  getWelcomeMessage,
  addVerifiedUser,
  isUserVerified,
  setBotInstance,
  removeVerifiedUser as removeUserVerified,
} from "../utils/membership.js";
import { adminMainKeyboard } from "../utils/format.js";

function buildJoinButtons(
  channels?: { chatId: string; title?: string }[]
): any {
  const kb: any[][] = [];

  if (channels) {
    for (const channel of channels) {
      const idx = channels.indexOf(channel);
      const label = channel.title || `Join Channel ${idx + 1}`;
      const link = channel.chatId.startsWith("-100")
        ? `https://t.me/c/${channel.chatId.slice(4)}`
        : `https://t.me/${channel.chatId.replace("@", "")}`;
      kb.push([Markup.button.url(label, link)]);
    }
  }

  kb.push([Markup.button.callback("Verify ✅", "verify")]);

  return Markup.inlineKeyboard(kb);
}

export function setupForceJoin(bot: Telegraf<any>) {
  setBotInstance(bot);

  bot.on("message", async (ctx, next) => {
    const user = ctx.from;
    if (!user || user.is_bot) return next();

    const AdminSet = (bot as any).__adminSet as Set<number>;
    if (AdminSet.has(user.id)) return next();

    const channels = await getRequiredChannels();
    if (channels.length === 0) {
      return next();
    }

    const alreadyVerified = await isUserVerified(user.id);
    if (alreadyVerified) {
      const { allJoined } = await checkAllChannels(user.id);
      if (!allJoined) {
        await removeUserVerified(user.id);
        return ctx.reply(
          "⚠️ You left a required channel. Please rejoin and verify again.",
          { reply_markup: buildJoinButtons(channels).reply_markup }
        );
      }
      return next();
    }

    const { allJoined, missingChannels } = await checkAllChannels(user.id);

    if (allJoined) {
      await addVerifiedUser(user.id);
      const welcomeMsg = await getWelcomeMessage();
      return ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
    }

    return ctx.reply(
      "📢 *Join required channels to use this bot!*",
      {
        parse_mode: "Markdown",
        reply_markup: buildJoinButtons(missingChannels).reply_markup,
      }
    );
  });

  bot.action("verify", async (ctx) => {
    const user = ctx.callbackQuery.from;
    await ctx.answerCbQuery();

    const { allJoined, missingChannels } = await checkAllChannels(user.id);

    if (allJoined) {
      await addVerifiedUser(user.id);
      await ctx.editMessageText(
        "✅ *Verified!* Welcome to the bot.",
        { parse_mode: "Markdown" }
      );
      const welcomeMsg = await getWelcomeMessage();
      await ctx.telegram.sendMessage(ctx.callbackQuery.message!.chat.id, welcomeMsg, {
        parse_mode: "Markdown",
      });
    } else {
      const channelList = missingChannels
        .map((c, i) => `• Channel ${i + 1}: ${c.title || c.chatId}`)
        .join("\n");
      await ctx.editMessageText(
        `❌ *Not joined yet!*\n\nPlease join:\n${channelList}`,
        {
          parse_mode: "Markdown",
          reply_markup: buildJoinButtons(missingChannels).reply_markup,
        }
      );
    }
  });

  bot.start(async (ctx) => {
    const user = ctx.from;
    if (!user) return;

    const AdminSet = (bot as any).__adminSet as Set<number>;
    if (AdminSet.has(user.id)) {
      // Admin gets access without verification - show regular admin panel via /start
      return ctx.reply(
        "👋 *Hey admin, the bot is ready!*\n\nChoose an option below:",
        {
          parse_mode: "Markdown",
          reply_markup: adminMainKeyboard().reply_markup,
        }
      );
    }

    const channels = await getRequiredChannels();
    if (channels.length === 0) {
      return ctx.reply("👋 *Welcome!* No channels required.", {
        parse_mode: "Markdown",
      });
    }

    const { allJoined, missingChannels } = await checkAllChannels(user.id);

    if (allJoined) {
      await addVerifiedUser(user.id);
      const welcomeMsg = await getWelcomeMessage();
      return ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
    }

    return ctx.reply(
      "📢 *Join required channels to use this bot!*",
      {
        parse_mode: "Markdown",
        reply_markup: buildJoinButtons(missingChannels).reply_markup,
      }
    );
  });
}

export { buildJoinButtons as joinButtonsMarkup };