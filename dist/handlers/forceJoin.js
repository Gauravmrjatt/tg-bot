"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupForceJoin = setupForceJoin;
exports.joinButtonsMarkup = buildJoinButtons;
const telegraf_1 = require("telegraf");
const membership_js_1 = require("../utils/membership.js");
const format_js_1 = require("../utils/format.js");
function buildJoinButtons(channels) {
    const kb = [];
    if (channels) {
        for (const channel of channels) {
            const idx = channels.indexOf(channel);
            const label = channel.title || `Join Channel ${idx + 1}`;
            const link = channel.chatId.startsWith("-100")
                ? `https://t.me/c/${channel.chatId.slice(4)}`
                : `https://t.me/${channel.chatId.replace("@", "")}`;
            kb.push([telegraf_1.Markup.button.url(label, link)]);
        }
    }
    kb.push([telegraf_1.Markup.button.callback("Verify ✅", "verify")]);
    return telegraf_1.Markup.inlineKeyboard(kb);
}
function setupForceJoin(bot) {
    (0, membership_js_1.setBotInstance)(bot);
    bot.on("message", async (ctx, next) => {
        const user = ctx.from;
        if (!user || user.is_bot)
            return next();
        const AdminSet = bot.__adminSet;
        if (AdminSet.has(user.id))
            return next();
        const channels = await (0, membership_js_1.getRequiredChannels)();
        if (channels.length === 0) {
            return next();
        }
        const alreadyVerified = await (0, membership_js_1.isUserVerified)(user.id);
        if (alreadyVerified) {
            const { allJoined } = await (0, membership_js_1.checkAllChannels)(user.id);
            if (!allJoined) {
                await (0, membership_js_1.removeVerifiedUser)(user.id);
                return ctx.reply("⚠️ You left a required channel. Please rejoin and verify again.", { reply_markup: buildJoinButtons(channels).reply_markup });
            }
            return next();
        }
        const { allJoined, missingChannels } = await (0, membership_js_1.checkAllChannels)(user.id);
        if (allJoined) {
            await (0, membership_js_1.addVerifiedUser)(user.id);
            const welcomeMsg = await (0, membership_js_1.getWelcomeMessage)();
            return ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
        }
        return ctx.reply("📢 *Join required channels to use this bot!*", {
            parse_mode: "Markdown",
            reply_markup: buildJoinButtons(missingChannels).reply_markup,
        });
    });
    bot.action("verify", async (ctx) => {
        const user = ctx.callbackQuery.from;
        await ctx.answerCbQuery();
        const { allJoined, missingChannels } = await (0, membership_js_1.checkAllChannels)(user.id);
        if (allJoined) {
            await (0, membership_js_1.addVerifiedUser)(user.id);
            await ctx.editMessageText("✅ *Verified!* Welcome to the bot.", { parse_mode: "Markdown" });
            const welcomeMsg = await (0, membership_js_1.getWelcomeMessage)();
            await ctx.telegram.sendMessage(ctx.callbackQuery.message.chat.id, welcomeMsg, {
                parse_mode: "Markdown",
            });
        }
        else {
            const channelList = missingChannels
                .map((c, i) => `• Channel ${i + 1}: ${c.title || c.chatId}`)
                .join("\n");
            await ctx.editMessageText(`❌ *Not joined yet!*\n\nPlease join:\n${channelList}`, {
                parse_mode: "Markdown",
                reply_markup: buildJoinButtons(missingChannels).reply_markup,
            });
        }
    });
    bot.start(async (ctx) => {
        const user = ctx.from;
        if (!user)
            return;
        const AdminSet = bot.__adminSet;
        if (AdminSet.has(user.id)) {
            // Admin gets access without verification - show regular admin panel via /start
            return ctx.reply("👋 *Hey admin, the bot is ready!*\n\nChoose an option below:", {
                parse_mode: "Markdown",
                reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
            });
        }
        const channels = await (0, membership_js_1.getRequiredChannels)();
        if (channels.length === 0) {
            return ctx.reply("👋 *Welcome!* No channels required.", {
                parse_mode: "Markdown",
            });
        }
        const { allJoined, missingChannels } = await (0, membership_js_1.checkAllChannels)(user.id);
        if (allJoined) {
            await (0, membership_js_1.addVerifiedUser)(user.id);
            const welcomeMsg = await (0, membership_js_1.getWelcomeMessage)();
            return ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
        }
        return ctx.reply("📢 *Join required channels to use this bot!*", {
            parse_mode: "Markdown",
            reply_markup: buildJoinButtons(missingChannels).reply_markup,
        });
    });
}
