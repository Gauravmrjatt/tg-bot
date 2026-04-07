"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAdminRelay = setupAdminRelay;
const redis_js_1 = require("../utils/redis.js");
const index_js_1 = require("../models/index.js");
const settings_js_1 = require("../utils/settings.js");
const broadcast_js_1 = require("./broadcast.js");
const format_js_1 = require("../utils/format.js");
const PM = "Markdown";
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
        const safeName = (0, format_js_1.esc)(`${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}${ctx.from.username ? " (@" + ctx.from.username + ")" : ""}`);
        const adminIdsArray = Array.from(adminSet);
        if (adminIdsArray.length === 0) {
            await ctx.reply("⚠️ _No admins are configured. Contact the bot owner._", { parse_mode: PM });
            return;
        }
        let successCount = 0;
        for (const adminId of adminIdsArray) {
            try {
                const fwd = await bot.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
                await bot.telegram.sendMessage(adminId, `📨 *from:* ${safeName}\n🆔 *ID:* \`${userId}\``, { parse_mode: PM });
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
        const user = await index_js_1.UserModel.findOne({ tgId: targetUserId });
        const fn = (0, format_js_1.esc)(m.reply_to_message?.from?.first_name || user?.firstName || "N/A");
        const ln = (0, format_js_1.esc)(m.reply_to_message?.from?.last_name || user?.lastName || "");
        const un = (0, format_js_1.esc)(m.reply_to_message?.from?.username || user?.username || "N/A");
        const id = m.reply_to_message?.from?.id || targetUserId;
        let out = "👤 *User Info*\n\n";
        out += `*Name:* ${fn}${ln ? " " + ln : ""}\n`;
        out += `*Username:* @${un}\n`;
        out += `*ID:* \`${id}\`\n`;
        if (user) {
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
        }
        return ctx.reply(out, { parse_mode: PM });
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
            if (!text.trim()) {
                return ctx.reply("❌ Message cannot be empty. Send your broadcast text:", {
                    parse_mode: PM,
                    reply_markup: (0, format_js_1.cancelKeyboard)().reply_markup,
                });
            }
            await (0, redis_js_1.clearAdminState)(uid);
            await (0, broadcast_js_1.runBroadcast)(bot, ctx, text);
            break;
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
        default:
            await (0, redis_js_1.clearAdminState)(uid);
    }
}
