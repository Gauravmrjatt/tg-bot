"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAdminPanelCallbacks = setupAdminPanelCallbacks;
const telegraf_1 = require("telegraf");
const redis_js_1 = require("../utils/redis.js");
const PM = "Markdown";
function adminPanelKeyboard() {
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("📋 Set Channels", "admin_set_channels")],
        [telegraf_1.Markup.button.callback("💬 Set Welcome", "admin_set_welcome")],
        [telegraf_1.Markup.button.callback("👁️ Preview Welcome", "admin_preview")],
    ]);
}
function adminMainKeyboard() {
    return telegraf_1.Markup.keyboard([
        ["📊 Stats", "📢 Broadcast"],
        ["⚡ Auto Approve", "🔍 Bcast Status"],
        ["➕ Add Admin", "➖ Remove Admin"],
        ["👥 List Admins", "⚙️ Config"],
        ["📍 Set Channel", "🔗 Set Link"],
        ["🚫 Ban User", "✅ Unban User"],
        ["📋 List Banned"],
    ]).resize();
}
function setupAdminPanelCallbacks(bot) {
    bot.action("admin_set_channels", async (ctx) => {
        const userId = ctx.callbackQuery.from.id;
        await ctx.answerCbQuery("Send channel username or ID");
        await (0, redis_js_1.setAdminState)(userId, { action: "add_required_channel" });
        await ctx.editMessageText("📝 *Send the channel username (e.g., @channelname) or numeric ID (e.g., -1001234567890)*", {
            parse_mode: "Markdown",
            reply_markup: telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("❌ Cancel", "admin_cancel")]
            ]).reply_markup
        });
    });
    bot.action("admin_set_welcome", async (ctx) => {
        const userId = ctx.callbackQuery.from.id;
        await ctx.answerCbQuery("Send welcome message text");
        await (0, redis_js_1.setAdminState)(userId, { action: "set_welcome_message" });
        await ctx.editMessageText("📝 *Send the welcome message text you want to use*", {
            parse_mode: "Markdown",
            reply_markup: telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("❌ Cancel", "admin_cancel")]
            ]).reply_markup
        });
    });
    bot.action("admin_preview", async (ctx) => {
        await ctx.answerCbQuery();
        const welcomeMsg = await (0, redis_js_1.getSetting)("welcome_message") || "Welcome! Thanks for joining our channels.";
        await ctx.editMessageText(`👁️ *Current Welcome Message:*\n\n${welcomeMsg}`, {
            parse_mode: "Markdown",
            reply_markup: telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("⬅️ Back", "admin_back")]
            ]).reply_markup
        });
    });
    bot.action("admin_back", async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText("🛠️ *Admin Panel*", {
            parse_mode: PM,
            reply_markup: adminPanelKeyboard().reply_markup
        });
    });
    bot.action("admin_cancel", async (ctx) => {
        const userId = ctx.callbackQuery.from.id;
        await ctx.answerCbQuery("Cancelled");
        await (0, redis_js_1.clearAdminState)(userId);
        await ctx.editMessageText("🛠️ *Admin Panel*", {
            parse_mode: PM,
            reply_markup: adminPanelKeyboard().reply_markup
        });
    });
    // Handle admin state inputs
    bot.on("message", async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId)
            return next();
        const adminState = await (0, redis_js_1.getAdminState)(userId);
        if (!adminState)
            return next();
        const text = ctx.message.text;
        if (!text)
            return next();
        // Clear state after processing
        await (0, redis_js_1.clearAdminState)(userId);
        switch (adminState.action) {
            case "add_required_channel": {
                const channelInput = text.trim();
                if (!channelInput) {
                    return ctx.reply("❌ Please provide a valid channel username or ID");
                }
                try {
                    // Get current required channels
                    const channelsData = await (0, redis_js_1.getSetting)("required_channels");
                    let channels = [];
                    if (channelsData) {
                        try {
                            channels = JSON.parse(channelsData);
                        }
                        catch {
                            channels = [];
                        }
                    }
                    // Check if already exists
                    const exists = channels.some(c => c.chatId === channelInput);
                    if (exists) {
                        return ctx.reply(`⚠️ Channel ${channelInput} is already in the list`);
                    }
                    // Try to get channel info
                    let title;
                    try {
                        const chat = await ctx.telegram.getChat(channelInput);
                        title = chat.title;
                    }
                    catch (err) {
                        // If we can't get chat info, still add it but without title
                        const error = err;
                        console.warn(`Could not fetch info for ${channelInput}:`, error.message);
                    }
                    // Add channel
                    channels.push({ chatId: channelInput, title });
                    await (0, redis_js_1.setSetting)("required_channels", JSON.stringify(channels));
                    return ctx.reply(`✅ *Channel added!*\n\n${channelInput}${title ? ` (${title})` : ""}`, {
                        parse_mode: "Markdown",
                        reply_markup: adminPanelKeyboard().reply_markup
                    });
                }
                catch (err) {
                    return ctx.reply(`❌ Failed to add channel: ${err.message}`, { parse_mode: "Markdown" });
                }
            }
            case "set_welcome_message": {
                const welcomeText = text.trim();
                if (!welcomeText) {
                    return ctx.reply("❌ Welcome message cannot be empty");
                }
                await (0, redis_js_1.setSetting)("welcome_message", welcomeText);
                return ctx.reply("✅ *Welcome message updated!*", {
                    parse_mode: "Markdown",
                    reply_markup: adminPanelKeyboard().reply_markup
                });
            }
            default:
                return next();
        }
    });
}
