"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAdminRelay = setupAdminRelay;
const redis_js_1 = require("../utils/redis.js");
const index_js_1 = require("../models/index.js");
const settings_js_1 = require("../utils/settings.js");
const broadcast_js_1 = require("./broadcast.js");
const format_js_1 = require("../utils/format.js");
const PM = "Markdown";
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
    // --- User message forwarding to admins ---
    bot.on("message", async (ctx, next) => {
        if (!ctx.from)
            return next();
        // Admin: check for reply to forwarded message OR interactive flow
        if (adminSet.has(ctx.from.id)) {
            const m = ctx.message;
            const replyTo = m.reply_to_message;
            // First priority: admin replying to a forwarded message
            if (replyTo?.message_id) {
                const userId = await (0, redis_js_1.getForwardedAdminUser)(ctx.chat.id, replyTo.message_id);
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
                        const alreadyBanned = await (0, redis_js_1.isUserBanned)(userId);
                        if (alreadyBanned)
                            return ctx.reply(`⚠ _User_ \`${userId}\` _is already banned._`, { parse_mode: PM });
                        await (0, redis_js_1.banUser)(userId);
                        await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { isBanned: true } }, { upsert: true });
                        return ctx.reply(`🚫 _User_ \`${userId}\` _has been banned._`, { parse_mode: PM });
                    }
                    if (replyText === "/unban" || replyText.startsWith("/unban ")) {
                        const banned = await (0, redis_js_1.isUserBanned)(userId);
                        if (!banned)
                            return ctx.reply(`⚠ _User_ \`${userId}\` _is not banned._`, { parse_mode: PM });
                        await (0, redis_js_1.unbanUser)(userId);
                        await index_js_1.UserModel.updateOne({ tgId: userId }, { $set: { isBanned: false } });
                        return ctx.reply(`✅ _User_ \`${userId}\` _has been unbanned._`, { parse_mode: PM });
                    }
                    try {
                        await bot.telegram.copyMessage(userId, ctx.chat.id, ctx.message.message_id);
                        await ctx.reply(`✅ _Reply sent to user_ \`${userId}\``, { parse_mode: PM });
                    }
                    catch (err) {
                        const errMsg = err.response?.description || err.message || "Unknown";
                        await ctx.reply(`❌ _Failed:_ ${errMsg}`, { parse_mode: PM });
                    }
                    return;
                }
            }
            // Second priority: interactive admin state flow
            const state = await (0, redis_js_1.getAdminState)(ctx.from.id);
            if (state) {
                await handleAdminFlow(bot, ctx, state, adminSet);
                return;
            }
            // Admin sent a regular message with no state and no reply mapping — ignore
            return next();
        }
        // Non-admin: forward DMs to admins
        if (ctx.chat.type !== "private")
            return next();
        const m2 = ctx.message;
        if (m2.text && m2.text.startsWith("/"))
            return next();
        const userId = ctx.from.id;
        // Check if user is banned
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
    // --- /info command ---
    bot.command("info", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return;
        let targetUserId;
        const m = ctx.message;
        // If replying to a forwarded message, resolve via Redis mapping
        if (m.reply_to_message?.message_id) {
            const fwdUserId = await (0, redis_js_1.getForwardedAdminUser)(ctx.chat.id, m.reply_to_message.message_id);
            if (fwdUserId) {
                await showUserInfo(ctx, fwdUserId);
                return;
            }
        }
        // Fallback: use replied user ID or parse from command text
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
    // --- /bcast command ---
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
}
async function handleAdminFlow(bot, ctx, state, adminSet) {
    const text = ctx.message.text || "";
    const cancel = text === "❌ Cancel";
    if (cancel || text === "/cancel") {
        await (0, redis_js_1.clearAdminState)(ctx.from.id);
        return ctx.reply("🔙 _Operation cancelled._", {
            parse_mode: PM,
            reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
        });
    }
    const uid = ctx.from.id;
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
            return ctx.reply(`🔻 _User_ \`${userId}\` _is no longer an admin._`, {
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
                return ctx.reply("❌ Invalid Telegram link. Example: \`https://t.me/+xxxxx\`:", {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                });
            }
            await (0, settings_js_1.setChannelLink)(text);
            await (0, redis_js_1.clearAdminState)(uid);
            return ctx.reply("✅ *Channel invite link set.*", {
                parse_mode: PM,
                reply_markup: (0, format_js_1.adminMainKeyboard)().reply_markup,
            });
        }
        case "broadcast": {
            const m = ctx.message;
            const data = state.data;
            // Step 1: Receive message (text or photo)
            if (!data?.text && !data?.photoFileId) {
                const photo = m.photo?.[m.photo.length - 1];
                const caption = m.caption || "";
                if (photo) {
                    // Photo broadcast
                    await (0, redis_js_1.setAdminState)(uid, { action: "broadcast", data: { step: "ask_button_text", text: caption, photoFileId: photo.file_id } });
                    return ctx.reply("📸 *Photo received.*\n\n_Send button text (or type *skip* to send without a button):_", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                if (!text.trim()) {
                    return ctx.reply("❌ Send a photo with caption, or type text message:", {
                        parse_mode: PM,
                        reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                    });
                }
                // Text broadcast
                await (0, redis_js_1.setAdminState)(uid, { action: "broadcast", data: { step: "ask_button_text", text: text } });
                return ctx.reply("📝 *Text received.*\n\n_Send button text (or type *skip* to send without a button):_", {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                });
            }
            // Step 2: Receive button text
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
            // Step 3: Receive button URL
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
            // Fallback
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
    }
}
