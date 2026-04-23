"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAdminRelay = setupAdminRelay;
const telegraf_1 = require("telegraf");
const redis_js_1 = require("../utils/redis.js");
const index_js_1 = require("../models/index.js");
const settings_js_1 = require("../utils/settings.js");
const broadcast_js_1 = require("./broadcast.js");
const format_js_1 = require("../utils/format.js");
const PM = "Markdown";
function adminPanelKeyboard() {
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("📋 Set Channels", "admin_set_channels")],
        [telegraf_1.Markup.button.callback("💬 Set Welcome", "admin_set_welcome")],
        [telegraf_1.Markup.button.callback("👁️ Preview Welcome", "admin_preview")],
        [telegraf_1.Markup.button.callback("⬅️ Back to Menu", "admin_back")],
    ]);
}
async function showUserInfo(ctx, targetUserId) {
    const user = await index_js_1.UserModel.findOne({ tgId: targetUserId });
    if (!user) {
        return ctx.reply(`👤 *User Info*\n\n*ID:* \`${targetUserId}\`\n\n⚠️ _User not found in database._`, { parse_mode: PM });
    }
    const fn = (0, format_js_1.esc)(user.firstName || "N/A");
    const ln = (0, format_js_1.esc)(user.lastName || "");
    const un = (0, format_js_1.esc)(user.username || "N/A");
    let out = "👤 *User Info*\n\n";
    out += `*Name:* ${fn}${ln ? " " + ln : ""}\n`;
    out += `*Username:* @${un}\n`;
    out += `*ID:* \`${targetUserId}\`\n`;
    out += `\n*Joined:* ${user.joinedAt.toISOString().slice(0, 10)}\n`;
    const diff = Date.now() - user.lastActiveAt.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60)
        out += `*Last Active:* ${sec}s ago\n`;
    else if (sec < 3600)
        out += `*Last Active:* ${Math.floor(sec / 60)}m ago\n`;
    else if (sec < 86400)
        out += `*Last Active:* ${Math.floor(sec / 3600)}h ago\n`;
    else
        out += `*Last Active:* ${Math.floor(sec / 86400)}d ago\n`;
    out += `*Admin:* ${user.isAdmin ? "✅" : "❌"}\n`;
    return ctx.reply(out, { parse_mode: PM });
}
function setupAdminRelay(bot, adminSet) {
    bot.command("admin", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        await ctx.reply("🛠️ *Admin Panel*", {
            parse_mode: PM,
            reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup
        });
    });
    bot.action("admin_set_channels", async (ctx) => {
        const userId = ctx.callbackQuery.from.id;
        await ctx.answerCbQuery("Send channel username or ID");
        await (0, redis_js_1.setAdminState)(userId, { action: "add_required_channel" });
        await ctx.editMessageText("📝 *Send the channel username (e.g., @channelname) or numeric ID (e.g., -1001234567890)*", {
            parse_mode: PM,
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
            parse_mode: PM,
            reply_markup: telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("❌ Cancel", "admin_cancel")]
            ]).reply_markup
        });
    });
    bot.action("admin_preview", async (ctx) => {
        await ctx.answerCbQuery();
        const welcomeMsg = await (0, redis_js_1.getSetting)("welcome_message") || "Welcome! Thanks for joining our channels.";
        await ctx.editMessageText(`👁️ *Current Welcome Message:*\n\n${welcomeMsg}`, {
            parse_mode: PM,
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
    bot.on("message", async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId)
            return next();
        const adminState = await (0, redis_js_1.getAdminState)(userId);
        if (!adminState)
            return next();
        console.log(`[AdminRelay Handler 1] User ${userId} has state:`, adminState);
        const text = ctx.message.text;
        if (!text)
            return next();
        switch (adminState.action) {
            case "add_required_channel": {
                await (0, redis_js_1.clearAdminState)(userId);
                const channelInput = text.trim();
                if (!channelInput) {
                    return ctx.reply("❌ Please provide a valid channel username or ID");
                }
                try {
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
                    const exists = channels.some(c => c.chatId === channelInput);
                    if (exists) {
                        return ctx.reply(`⚠️ Channel ${channelInput} is already in the list`);
                    }
                    let title;
                    try {
                        const chat = await ctx.telegram.getChat(channelInput);
                        title = chat.title;
                    }
                    catch (err) {
                        console.warn(`Could not fetch info for ${channelInput}:`, err.message);
                    }
                    channels.push({ chatId: channelInput, title });
                    await (0, redis_js_1.setSetting)("required_channels", JSON.stringify(channels));
                    return ctx.reply(`✅ *Channel added!*\n\n${channelInput}${title ? ` (${title})` : ""}`, {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup
                    });
                }
                catch (err) {
                    return ctx.reply(`❌ Failed to add channel: ${err.message}`, { parse_mode: "Markdown" });
                }
            }
            case "set_welcome_message": {
                await (0, redis_js_1.clearAdminState)(userId);
                const welcomeText = text.trim();
                if (!welcomeText) {
                    return ctx.reply("❌ Welcome message cannot be empty");
                }
                await (0, redis_js_1.setSetting)("welcome_message", welcomeText);
                return ctx.reply("✅ *Welcome message updated!*", {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup
                });
            }
            default:
                console.log(`[AdminRelay Handler 1] Action ${adminState.action} not handled, passing to next`);
                return next();
        }
    });
    bot.on("message", async (ctx, next) => {
        if (!ctx.from)
            return next();
        if (adminSet.has(ctx.from.id)) {
            const m = ctx.message;
            const replyTo = m.reply_to_message;
            if (replyTo?.message_id) {
                // ... (reply logic remains the same)
            }
            const state = await (0, redis_js_1.getAdminState)(ctx.from.id);
            console.log("Admin state for user", ctx.from.id, ":", state);
            if (state) {
                await handleAdminFlow(bot, ctx, state, adminSet);
                return;
            }
            return next();
        }
        if (ctx.chat.type !== "private")
            return next();
        const m2 = ctx.message;
        if (m2.text && m2.text.startsWith("/"))
            return next();
        const userId = ctx.from.id;
        const requiredChannels = await (0, redis_js_1.getRequiredChannels)();
        console.log("User", userId, "requiredChannels:", requiredChannels.length);
        if (requiredChannels.length > 0) {
            const verifiedChatIds = await (0, redis_js_1.getUserVerifiedChannels)(userId);
            console.log("User", userId, "verifiedChatIds:", verifiedChatIds);
            const verifiedSet = new Set(verifiedChatIds);
            const allJoined = requiredChannels.every(ch => verifiedSet.has(ch.chatId));
            console.log("User", userId, "allJoined:", allJoined);
            if (!allJoined) {
                let msg = "Join all channels first:\n\n";
                for (const ch of requiredChannels) {
                    msg += "- " + ch.name + "\n";
                }
                msg += "\nThen click /verify";
                await ctx.reply(msg);
                return;
            }
        }
        const banned = await (0, redis_js_1.isUserBanned)(userId);
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
                await (0, redis_js_1.mapForwardedId)(adminId, fwd.message_id, userId);
                successCount++;
            }
            catch (e) {
                const errMsg = e?.response?.description || e?.message || "Unknown";
                console.error(`Failed to forward to admin ${adminId}: ${errMsg}`);
            }
        }
        if (successCount > 0) {
            await ctx.reply("✅ _Your message has been sent to admins._", { parse_mode: PM });
        }
        else {
            await ctx.reply("❌ _Failed to reach any admin. Try again later._", { parse_mode: PM });
        }
    });
    bot.command("info", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        let targetUserId;
        const m = ctx.message;
        if (m.reply_to_message?.message_id) {
            const fwdUserId = await (0, redis_js_1.getForwardedAdminUser)(ctx.chat.id, m.reply_to_message.message_id);
            if (fwdUserId) {
                await showUserInfo(ctx, fwdUserId);
                return;
            }
            const fwdFrom = m.reply_to_message.forward_from;
            if (fwdFrom?.id) {
                await showUserInfo(ctx, Number(fwdFrom.id));
                return;
            }
        }
        if (m.reply_to_message?.from)
            targetUserId = m.reply_to_message.from.id;
        if (!targetUserId) {
            const txt = ctx.message.text.slice("/info".length).trim();
            if (txt) {
                const p = parseInt(txt, 10);
                if (!isNaN(p))
                    targetUserId = p;
            }
        }
        if (!targetUserId && ctx.chat.type === "private")
            targetUserId = ctx.chat.id;
        if (!targetUserId)
            return;
        await showUserInfo(ctx, targetUserId);
    });
    bot.command("bcast", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        const id = ctx.message.text.slice("/bcast".length).trim();
        if (!id)
            return ctx.reply("Usage: `/bcast <id>`", { parse_mode: PM });
        const bc = await index_js_1.BroadcastModel.findOne({ messageId: id }).lean();
        if (!bc)
            return ctx.reply("Broadcast not found.", { parse_mode: PM });
        let msg = `📢 *Broadcast* \`${bc.messageId}\`\n`;
        msg += `*Status:* _${bc.status}_\n`;
        msg += `*Sent:* ${bc.sentAt.toISOString().slice(0, 19).replace("T", " ")}\n\n`;
        msg += `🟢 Delivered: *${bc.delivered}*\n🔴 Failed: *${bc.failed}*\n📊 Total: *${bc.totalTargeted}*`;
        return ctx.reply(msg, { parse_mode: PM });
    });
    bot.command("ban", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        let targetUserId;
        const m = ctx.message;
        if (m.reply_to_message?.message_id) {
            const fwdUserId = await (0, redis_js_1.getForwardedAdminUser)(ctx.chat.id, m.reply_to_message.message_id);
            if (fwdUserId)
                targetUserId = fwdUserId;
            else {
                const fwdFrom = m.reply_to_message.forward_from;
                if (fwdFrom?.id)
                    targetUserId = Number(fwdFrom.id);
            }
        }
        if (m.reply_to_message?.from)
            targetUserId = m.reply_to_message.from.id;
        if (!targetUserId) {
            const txt = ctx.message.text.slice("/ban".length).trim();
            if (txt) {
                const p = parseInt(txt, 10);
                if (!isNaN(p))
                    targetUserId = p;
            }
        }
        if (!targetUserId)
            return ctx.reply("Reply to a forwarded message or provide user ID.");
        await (0, redis_js_1.banUser)(targetUserId);
        await index_js_1.UserModel.updateOne({ tgId: targetUserId }, { $set: { isBanned: true } }, { upsert: true });
        return ctx.reply(`User ${targetUserId} has been banned.`);
    });
    bot.command("unban", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        let targetUserId;
        const m = ctx.message;
        if (m.reply_to_message?.message_id) {
            const fwdUserId = await (0, redis_js_1.getForwardedAdminUser)(ctx.chat.id, m.reply_to_message.message_id);
            if (fwdUserId)
                targetUserId = fwdUserId;
            else {
                const fwdFrom = m.reply_to_message.forward_from;
                if (fwdFrom?.id)
                    targetUserId = Number(fwdFrom.id);
            }
        }
        if (m.reply_to_message?.from)
            targetUserId = m.reply_to_message.from.id;
        if (!targetUserId) {
            const txt = ctx.message.text.slice("/unban".length).trim();
            if (txt) {
                const p = parseInt(txt, 10);
                if (!isNaN(p))
                    targetUserId = p;
            }
        }
        if (!targetUserId)
            return ctx.reply("Reply to a forwarded message or provide user ID.");
        await (0, redis_js_1.unbanUser)(targetUserId);
        await index_js_1.UserModel.updateOne({ tgId: targetUserId }, { $set: { isBanned: false } });
        return ctx.reply(`User ${targetUserId} has been unbanned.`);
    });
    async function handleAdminFlow(bot, ctx, state, adminSet) {
        const text = ctx.message.text || "";
        const uid = ctx.from.id;
        console.log(`[handleAdminFlow] Action: ${state.action}, User: ${uid}, Text: ${text}`);
        const cancel = text === "❌ Cancel";
        if (cancel || text === "/cancel") {
            await (0, redis_js_1.clearAdminState)(ctx.from.id);
            return ctx.reply("Operation cancelled.", {
                reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
            });
        }
        console.log("handleAdminFlow action:", state.action, "text:", text);
        switch (state.action) {
            case "add_admin": {
                const userId = parseInt(text, 10);
                if (isNaN(userId)) {
                    return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (adminSet.has(userId)) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply(`⚠ _User_ \`${userId}\` _is already an admin._`, {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                adminSet.add(userId);
                await (0, redis_js_1.addAdminId)(userId);
                await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { tgId: userId, isAdmin: true } }, { upsert: true });
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply(`✅ _User_ \`${userId}\` _is now an admin._`, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "remove_admin": {
                const userId = parseInt(text, 10);
                if (isNaN(userId) || userId === 0) {
                    return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (userId === uid) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply("🚫 _Cannot remove yourself._", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                if (!adminSet.has(userId)) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply(`⚠ _User_ \`${userId}\` _is not an admin._`, {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                adminSet.delete(userId);
                await (0, redis_js_1.removeAdminId)(userId);
                await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { isAdmin: false } });
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply(`���� _User_ \`${userId}\` _is no longer an admin._`, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "set_channel": {
                const chatId = parseInt(text, 10);
                if (isNaN(chatId)) {
                    return ctx.reply("❌ Invalid chat ID. Send a numeric ID:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                await (0, settings_js_1.setTargetChatId)(chatId);
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply(`✅ *Channel ID set to:* \`${chatId}\``, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "set_link": {
                if (!text.startsWith("https://t.me") && !text.startsWith("https://telegram.me")) {
                    return ctx.reply("Invalid Telegram link.", {
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                await (0, settings_js_1.setChannelLink)(text);
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply("Channel invite link set.", {
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "set_welcome_msg": {
                await (0, settings_js_1.setWelcomeMessage)(text);
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply("Welcome message set.", {
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "set_folder_link": {
                if (!text.includes("t.me") && !text.includes("telegram.me")) {
                    return ctx.reply("Invalid link.", {
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                await (0, settings_js_1.setFolderLink)(text);
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply("Folder link set.", {
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "add_channel": {
                const data = state.data;
                const step = data?.step;
                if (!step) {
                    await (0, redis_js_1.setAdminState)(uid, { action: "add_channel", data: { step: "name" } });
                    return ctx.reply("Add Channel - Step 1/3: Send the channel name:", {
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (step === "name") {
                    const name = text.trim();
                    if (!name)
                        return ctx.reply("Invalid name.", { reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup });
                    await (0, redis_js_1.setAdminState)(uid, { action: "add_channel", data: { step: "chatId", name } });
                    return ctx.reply("Add Channel - Step 2/3: Send the channel chat ID:", {
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (step === "chatId") {
                    const chatId = parseInt(text, 10);
                    if (isNaN(chatId))
                        return ctx.reply("Invalid chat ID.", { reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup });
                    const currentChannels = await (0, redis_js_1.getRequiredChannels)();
                    if (currentChannels.some(c => c.chatId === chatId)) {
                        await (0, redis_js_1.clearAdminState)(uid);
                        return ctx.reply("Channel already configured.", { reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup });
                    }
                    await (0, redis_js_1.setAdminState)(uid, { action: "add_channel", data: { step: "inviteLink", name: data?.name, chatId } });
                    return ctx.reply("Add Channel - Step 3/3: Send the invite link:", {
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (step === "inviteLink") {
                    const inviteLink = text.trim();
                    if (!inviteLink.startsWith("http")) {
                        return ctx.reply("Invalid link.", { reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup });
                    }
                    await (0, redis_js_1.addRequiredChannel)(data.name, data.chatId, inviteLink);
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply("Channel added: " + data.name, {
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                break;
            }
            case "broadcast": {
                const m = ctx.message;
                const data = state.data;
                if (!data?.text && !data?.photoFileId) {
                    const photo = m.photo?.[m.photo.length - 1];
                    const caption = m.caption || "";
                    if (photo) {
                        await (0, redis_js_1.setAdminState)(uid, { action: "broadcast", data: { step: "ask_button_text", text: caption, photoFileId: photo.file_id } });
                        return ctx.reply("📸 *Photo received.*\n\n_Send button text (or type *skip* to send without a button):_", {
                            parse_mode: PM,
                            reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                        });
                    }
                    if (!caption.trim()) {
                        return ctx.reply("❌ Send a photo with caption, or type text message:", {
                            parse_mode: PM,
                            reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                        });
                    }
                    await (0, redis_js_1.setAdminState)(uid, { action: "broadcast", data: { step: "ask_button_text", text: caption } });
                    return ctx.reply("📝 *Text received.*\n\n_Send button text (or type *skip* to send without a button):_", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (data?.step === "ask_button_text") {
                    if (text.toLowerCase() === "skip") {
                        await (0, redis_js_1.clearAdminState)(uid);
                        await (0, broadcast_js_1.runBroadcast)(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId });
                        return;
                    }
                    await (0, redis_js_1.setAdminState)(uid, { action: "broadcast", data: { ...data, step: "ask_button_url", buttonText: text } });
                    return ctx.reply("🔗 _Now send the button URL:_", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (data?.step === "ask_button_url") {
                    if (text.toLowerCase() === "skip") {
                        await (0, redis_js_1.clearAdminState)(uid);
                        await (0, broadcast_js_1.runBroadcast)(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId, buttonText: data.buttonText });
                        return;
                    }
                    if (!text.startsWith("http://") && !text.startsWith("https://")) {
                        return ctx.reply("❌ Invalid URL. Must start with http:// or https://:", {
                            parse_mode: PM,
                            reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                        });
                    }
                    await (0, redis_js_1.clearAdminState)(uid);
                    await (0, broadcast_js_1.runBroadcast)(bot, ctx, { text: data.text || "", photoFileId: data.photoFileId, buttonText: data.buttonText, buttonUrl: text });
                    return;
                }
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply("⚠ _Broadcast session expired. Please try again._", {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "bcast_status": {
                const bid = text.trim();
                await (0, redis_js_1.clearAdminState)(uid);
                if (!bid) {
                    return ctx.reply("❌ Invalid broadcast ID.", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                const bc = await index_js_1.BroadcastModel.findOne({ messageId: bid }).lean();
                if (!bc) {
                    return ctx.reply("Broadcast not found.", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                let msg = `📢 *Broadcast* \`${bc.messageId}\`\n`;
                msg += `*Status:* _${bc.status}_\n`;
                msg += `*Sent:* ${bc.sentAt.toISOString().slice(0, 19).replace("T", " ")}\n\n`;
                msg += `🟢 Delivered: *${bc.delivered}*\n🔴 Failed: *${bc.failed}*\n📊 Total: *${bc.totalTargeted}*`;
                return ctx.reply(msg, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "ban_user": {
                const userId = parseInt(text, 10);
                if (isNaN(userId)) {
                    return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (adminSet.has(userId)) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply("🚫 _Cannot ban an admin._", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                const alreadyBanned = await (0, redis_js_1.isUserBanned)(userId);
                if (alreadyBanned) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply(`⚠ _User_ \`${userId}\` _is already banned._`, {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                await (0, redis_js_1.banUser)(userId);
                await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { isBanned: true } }, { upsert: true });
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply(`🚫 _User_ \`${userId}\` _has been banned._`, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            case "unban_user": {
                const userId = parseInt(text, 10);
                if (isNaN(userId)) {
                    return ctx.reply("❌ Invalid user ID. Send a numeric ID:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                const banned = await (0, redis_js_1.isUserBanned)(userId);
                if (!banned) {
                    await (0, redis_js_1.clearAdminState)(uid);
                    return ctx.reply(`⚠ _User_ \`${userId}\` _is not banned._`, {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                    });
                }
                await (0, redis_js_1.unbanUser)(userId);
                await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { isBanned: false } });
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply(`✅ _User_ \`${userId}\` _has been unbanned._`, {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
            }
            default:
                await (0, redis_js_1.clearAdminState)(uid);
                return ctx.reply("Unknown action. Returning to menu.", {
                    reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
                });
        }
    }
}
