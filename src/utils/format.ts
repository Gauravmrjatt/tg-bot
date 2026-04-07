import { Markup } from "telegraf";

const PM = "Markdown" as const;

export function userInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 Help", "help")],
    [Markup.button.callback("🔗 Rejoin", "rejoin")],
    [Markup.button.callback("👤 My Info", "myinfo")],
    [Markup.button.callback("💬 Message Admin", "messageadmin")],
  ]);
}

export function adminInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📢 Broadcast", "admin_broadcast"), Markup.button.callback("📊 Stats", "admin_stats")],
    [Markup.button.callback("⚡ Auto Approve", "admin_autoapprove"), Markup.button.callback("🔍 Bcast Status", "admin_bcast_status")],
    [Markup.button.callback("➕ Add Admin", "admin_addadmin"), Markup.button.callback("➖ Remove Admin", "admin_removeadmin")],
    [Markup.button.callback("👥 List Admins", "admin_listadmins"), Markup.button.callback("⚙️ Config", "admin_config")],
    [Markup.button.callback("📍 Set Channel", "admin_setchannel"), Markup.button.callback("🔗 Set Link", "admin_channellink")],
    Markup.button.callback("📋 User Options", "menu"),
  ]);
}

export { PM };
