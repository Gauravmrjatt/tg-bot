import { Telegraf, Context, Markup } from "telegraf";
import {
  getSetting,
  setSetting,
  getAdminState,
  setAdminState,
  clearAdminState,
} from "../utils/redis.js";

const PM = "Markdown" as const;

function adminPanelKeyboard(): any {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 Set Channels", "admin_set_channels")],
    [Markup.button.callback("💬 Set Welcome", "admin_set_welcome")],
    [Markup.button.callback("👁️ Preview Welcome", "admin_preview")],
  ]);
}

function adminMainKeyboard() {
  return Markup.keyboard([
    ["📊 Stats", "📢 Broadcast"],
    ["⚡ Auto Approve", "🔍 Bcast Status"],
    ["➕ Add Admin", "➖ Remove Admin"],
    ["👥 List Admins", "⚙️ Config"],
    ["📍 Set Channel", "🔗 Set Link"],
    ["🚫 Ban User", "✅ Unban User"],
    ["📋 List Banned"],
  ]).resize();
}

export function setupAdminPanelCallbacks(bot: Telegraf<any>) {
  bot.action("admin_set_channels", async (ctx) => {
    const userId = ctx.callbackQuery.from.id;
    await ctx.answerCbQuery("Send channel username or ID");
    await setAdminState(userId, { action: "add_required_channel" });
    await ctx.editMessageText(
      "📝 *Send the channel username (e.g., @channelname) or numeric ID (e.g., -1001234567890)*",
      {
        parse_mode: "Markdown",
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
        parse_mode: "Markdown",
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
        parse_mode: "Markdown",
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

  // Handle admin state inputs
  bot.on("message", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const adminState = await getAdminState(userId);
    if (!adminState) return next();

    const text = (ctx.message as any).text;
    if (!text) return next();

    // Clear state after processing
    await clearAdminState(userId);

    switch (adminState.action) {
      case "add_required_channel": {
        const channelInput = text.trim();
        if (!channelInput) {
          return ctx.reply("❌ Please provide a valid channel username or ID");
        }

        try {
          // Get current required channels
          const channelsData = await getSetting("required_channels");
          let channels: { chatId: string; title?: string }[] = [];
          if (channelsData) {
            try {
              channels = JSON.parse(channelsData);
            } catch {
              channels = [];
            }
          }

          // Check if already exists
          const exists = channels.some(c => c.chatId === channelInput);
          if (exists) {
            return ctx.reply(`⚠️ Channel ${channelInput} is already in the list`);
          }

          // Try to get channel info
          let title: string | undefined;
          try {
            const chat = await ctx.telegram.getChat(channelInput) as any;
            title = chat.title;
          } catch (err) {
            // If we can't get chat info, still add it but without title
            const error = err as Error;
            console.warn(`Could not fetch info for ${channelInput}:`, error.message);
          }

          // Add channel
          channels.push({ chatId: channelInput, title });
          await setSetting("required_channels", JSON.stringify(channels));

          return ctx.reply(
            `✅ *Channel added!*\n\n${channelInput}${title ? ` (${title})` : ""}`,
            {
              parse_mode: "Markdown",
              reply_markup: adminPanelKeyboard().reply_markup
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
            parse_mode: "Markdown",
            reply_markup: adminPanelKeyboard().reply_markup
          }
        );
      }

      default:
        return next();
    }
  });
}