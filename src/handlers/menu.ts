import { Context, Telegraf, Markup } from "telegraf";
import { adminInlineKeyboard, userInlineKeyboard, PM } from "../utils/format.js";
import { getSetting } from "../utils/redis.js";
import { UserModel, JoinRequestModel, BroadcastModel } from "../models/index.js";

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function setupMenu(bot: Telegraf<Context>, adminSet: Set<number>) {
  // Show initial menu on /start
  bot.start(async (ctx) => {
    const kb = adminSet.has(ctx.from.id) ? adminInlineKeyboard() : userInlineKeyboard();
    return ctx.reply(
      "👋 *Hey, I'm alive and ready!*\n\nChoose an option below:",
      { parse_mode: PM, reply_markup: kb.reply_markup }
    );
  });

  // Refresh menu button
  bot.action("menu", async (ctx) => {
    if (!ctx.from) return;
    const kb = adminSet.has(ctx.from.id) ? adminInlineKeyboard() : userInlineKeyboard();
    return ctx.reply("📋 *Choose an option:*\n", { parse_mode: PM, reply_markup: kb.reply_markup });
  });

  // --- User callback actions ---
  bot.action("help", async (ctx) => {
    let h = "📋 *Available Commands*\n\n";
    h += "*/rejoin* — Get the channel invite link\n";
    h += "*💬 Message admin* — Just DM me!\n\n";
    h += "🔒 _Admin Commands_\n";
    h += "*/autoapprove* — Toggle auto-approve\n";
    h += "*/broadcast <msg>* — Send to all users\n";
    h += "*/bcast <id>* — Check broadcast\n";
    h += "*/stats* — Bot statistics\n";
    h += "*/reply* — Reply to user\n";
    h += "*/info* — View user info\n";
    h += "*/addadmin* / */removeadmin*\n";
    h += "*/listadmins* / */config*\n";
    h += "*/setchannelid* / */setchannellink*\n";
    await ctx.reply(h, { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("rejoin", async (ctx) => {
    const inviteLink = await getSetting("channel_link");
    if (!inviteLink) {
      return ctx.reply("🔗 _Invite link is not configured._", { parse_mode: PM });
    }
    await ctx.reply(`🔗 *Click to join:*\n\n${inviteLink}`, { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("myinfo", async (ctx) => {
    const user = await UserModel.findOne({ tgId: ctx.from.id });
    let out = "👤 *Your Info*\n\n";
    out += `*ID:* \`${ctx.from.id}\`\n`;
    out += `*Name:* ${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}\n`;
    out += `*Username:* ${ctx.from.username ? `\`@${ctx.from.username}\`` : "_N/A_"}\n`;
    if (user) {
      out += `\n*Joined:* ${user.joinedAt.toISOString().slice(0, 10)}\n`;
      out += `*Last Active:* ${user.lastActiveAt ? timeAgo(user.lastActiveAt) : "N/A"}\n`;
    }
    await ctx.reply(out, { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("messageadmin", async (ctx) => {
    await ctx.reply("💬 _Just send me a message and it will be forwarded to our admins._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  // --- Admin callback actions ---
  bot.action("admin_broadcast", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("📢 _Send the broadcast message using_ `/broadcast Your message here`", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_stats", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    const totalUsers = await UserModel.countDocuments();
    const pending = await JoinRequestModel.countDocuments({ status: "pending" });
    const approved = await JoinRequestModel.countDocuments({ status: "approved" });
    const declined = await JoinRequestModel.countDocuments({ status: "declined" });
    const broadcasts = await BroadcastModel.countDocuments();

    let msg = `📊 *Bot Stats*\n\n`;
    msg += `*Users:* ${totalUsers}\n`;
    msg += `*Pending:* ${pending}\n`;
    msg += `*Approved:* ${approved}\n`;
    msg += `*Declined:* ${declined}\n`;
    msg += `*Broadcasts:* ${broadcasts}`;
    await ctx.reply(msg, { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_autoapprove", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("⚡ _Use_ `/autoapprove` _to toggle._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_bcast_status", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("🔍 _Use_ `/bcast <id>` _to check status._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_config", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("⚙️ _Use_ `/config` _to view settings._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_addadmin", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("➕ _Use_ `/addadmin <userId>`_._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_removeadmin", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("➖ _Use_ `/removeadmin <userId>`_._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_listadmins", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    const ids = [...adminSet].map((id) => `\`${id}\``).join(", ");
    await ctx.reply(`🛡️ *Admins* (${adminSet.size}):\n\n${ids}`, { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_setchannel", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("📍 _Use_ `/setchannelid <chat_id>`_._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });

  bot.action("admin_channellink", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return ctx.answerCbQuery("🚫 Not authorized.");
    await ctx.reply("🔗 _Use_ `/setchannellink <link>`_._", { parse_mode: PM });
    await ctx.answerCbQuery();
  });
}
