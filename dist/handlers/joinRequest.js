"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupJoinRequest = setupJoinRequest;
const telegraf_1 = require("telegraf");
const index_js_1 = require("../models/index.js");
const redis_js_1 = require("../utils/redis.js");
const settings_js_1 = require("../utils/settings.js");
const format_js_1 = require("../utils/format.js");
function setupJoinRequest(bot, adminSet) {
    // Admin only — toggle global auto-approve (default OFF)
    bot.command("autoapprove", async (ctx) => {
        if (!ctx.from || !adminSet.has(ctx.from.id))
            return ctx.reply("Admin only.");
        const current = await (0, redis_js_1.getAutoApprove)();
        await (0, redis_js_1.setAutoApprove)(!current);
        return ctx.reply(`⚡ *Auto-approve* is now _${!current ? "ON" : "OFF"}_.\n${!current ? "✅ Join requests will be approved automatically." : "🛡️ Admins will review each request."}`, { parse_mode: "Markdown" });
    });
    bot.on("chat_join_request", async (ctx) => {
        const joinReq = ctx.chatJoinRequest;
        const user = joinReq.from;
        const globalAuto = await (0, redis_js_1.getAutoApprove)();
        const targetChatId = await (0, settings_js_1.getTargetChatId)();
        await index_js_1.UserModel.updateOne({ tgId: user.id }, {
            $set: {
                tgId: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                username: user.username,
                isAdmin: adminSet.has(user.id),
                lastActiveAt: new Date(),
            },
        }, { upsert: true });
        const safeName = (0, format_js_1.esc)(`${user.first_name}${user.last_name ? " " + user.last_name : ""}${user.username ? " (@" + user.username + ")" : ""}`);
        if (globalAuto) {
            try {
                await bot.telegram.approveChatJoinRequest(joinReq.chat.id, user.id);
                await index_js_1.JoinRequestModel.create({
                    chatId: targetChatId ?? joinReq.chat.id,
                    userId: user.id,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    username: user.username,
                    autoApproved: true,
                    approvedBy: 0,
                    status: "approved",
                    actionAt: new Date(),
                });
            }
            catch (err) {
                console.error("Auto-approve failed:", err);
            }
        }
        else {
            await (0, redis_js_1.cachePendingRequest)(user.id, {
                chatId: joinReq.chat.id,
                userId: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                username: user.username,
            });
            const kb = telegraf_1.Markup.inlineKeyboard([
                telegraf_1.Markup.button.callback("Approve", `approve:${user.id}`),
                telegraf_1.Markup.button.callback("Decline", `decline:${user.id}`),
            ]);
            for (const adminId of adminSet) {
                try {
                    const msg = await bot.telegram.sendMessage(adminId, `📨 *Join Request*\n\n*Name:* _${safeName}_\n*Chat ID:* \`${joinReq.chat.id}\``, {
                        parse_mode: "Markdown",
                        reply_markup: kb.reply_markup,
                    });
                    await index_js_1.JoinRequestModel.create({
                        chatId: targetChatId ?? joinReq.chat.id,
                        userId: user.id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        username: user.username,
                        autoApproved: false,
                        status: "pending",
                        adminChatId: msg.chat.id,
                        adminMessageId: msg.message_id,
                    });
                }
                catch {
                    /* ignore */
                }
            }
        }
        return true;
    });
    bot.action(/^approve:(\d+)$/, async (ctx) => {
        const userId = parseInt(ctx.match[1], 10);
        const cbUser = ctx.callbackQuery.from;
        if (!adminSet.has(cbUser.id))
            return ctx.answerCbQuery("Not authorized.");
        const cached = await (0, redis_js_1.getPendingRequest)(userId);
        if (!cached) {
            const req = await index_js_1.JoinRequestModel.findOneAndUpdate({ userId, status: "pending" }, { $set: { status: "approved", approvedBy: cbUser.id, actionAt: new Date() } });
            if (!req)
                return ctx.answerCbQuery("Request no longer exists.");
            try {
                await bot.telegram.approveChatJoinRequest(req.chatId, userId);
                await ctx.editMessageText(`Approved join request from ${req.firstName}`);
                return ctx.answerCbQuery("Approved.");
            }
            catch {
                return ctx.answerCbQuery("Failed to approve.");
            }
        }
        await (0, redis_js_1.removePendingRequest)(userId);
        await index_js_1.JoinRequestModel.updateOne({ userId }, { $set: { status: "approved", approvedBy: cbUser.id, actionAt: new Date() } });
        try {
            await bot.telegram.approveChatJoinRequest(cached.chatId, userId);
            await ctx.editMessageText(`Approved join request from ${cached.firstName}`);
            return ctx.answerCbQuery("Approved.");
        }
        catch {
            return ctx.answerCbQuery("Failed to approve.");
        }
    });
    bot.action(/^decline:(\d+)$/, async (ctx) => {
        const userId = parseInt(ctx.match[1], 10);
        const cbUser = ctx.callbackQuery.from;
        if (!adminSet.has(cbUser.id))
            return ctx.answerCbQuery("Not authorized.");
        const cached = await (0, redis_js_1.getPendingRequest)(userId);
        if (!cached) {
            const req = await index_js_1.JoinRequestModel.findOneAndUpdate({ userId, status: "pending" }, { $set: { status: "declined", approvedBy: cbUser.id, actionAt: new Date() } });
            if (!req)
                return ctx.answerCbQuery("Request no longer exists.");
            try {
                await bot.telegram.declineChatJoinRequest(req.chatId, userId);
                await ctx.editMessageText(`Declined join request from ${req.firstName}`);
                return ctx.answerCbQuery("Declined.");
            }
            catch {
                return ctx.answerCbQuery("Failed to decline.");
            }
        }
        await (0, redis_js_1.removePendingRequest)(userId);
        await index_js_1.JoinRequestModel.updateOne({ userId }, { $set: { status: "declined", approvedBy: cbUser.id, actionAt: new Date() } });
        try {
            await bot.telegram.declineChatJoinRequest(cached.chatId, userId);
            await ctx.editMessageText(`Declined join request from ${cached.firstName}`);
            return ctx.answerCbQuery("Declined.");
        }
        catch {
            return ctx.answerCbQuery("Failed to decline.");
        }
    });
}
