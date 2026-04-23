import { Markup } from "telegraf";

const KB = "Markdown" as const;

// Escape special characters for Telegram MarkdownV2/Markdown
export function esc(s: string): string {
  return s.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}

// User main keyboard — reply buttons at bottom
export function userMainKeyboard() {
  return Markup.keyboard([
    ["📁 Join Channels", "💬 Message Admin"],
  ]).resize();
}

// Welcome message keyboard for verified users
export function userWelcomeKeyboard(welcomeMsg?: string) {
  return Markup.keyboard([
    //["🔗 Rejoin", "💬 Message Admin"],
  ]).resize();
}

// Channel verification keyboard
export function channelVerificationKeyboard(channels: { name: string; chatId: number; inviteLink: string }[]) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ I Have Joined", "verify_channels")],
    [Markup.button.callback("📋 View Channels", "view_channels")],
  ]);
}

// View channels keyboard with join buttons
export function viewChannelsKeyboard(channels: { name: string; chatId: number; inviteLink: string }[]) {
  const rows: any[][] = [];
  for (const ch of channels) {
    rows.push([Markup.button.url(`➕ Join ${ch.name}`, ch.inviteLink)]);
  }
  rows.push([Markup.button.callback("✅ I Have Joined", "verify_channels")]);
  return Markup.inlineKeyboard(rows);
}

// Remove channel keyboard
export function channelListKeyboard(channels: { name: string; chatId: number }[]) {
  const rows: any[][] = [];
  for (const ch of channels) {
    rows.push([Markup.button.callback(`❌ Remove ${ch.name}`, `remove_channel:${ch.chatId}`)]);
  }
  rows.push([Markup.button.callback("➕ Add Channel", "add_channel_flow")]);
  rows.push([Markup.button.callback("🔙 Back", "admin_back")]);
  return Markup.inlineKeyboard(rows);
}

// Admin main keyboard
export function adminMainKeyboard() {
  return Markup.keyboard([
    ["📊 Stats", "📢 Broadcast"],
    ["⚡ Auto Approve", "🔍 Bcast Status"],
    ["➕ Add Admin", "➖ Remove Admin"],
    ["👥 List Admins", "⚙️ Config"],
    ["📍 Approve Channel", "🔗 Set Link"],
    ["📁 Set Folder", "💬 Welcome Msg"],
    ["📋 Manage Channels", "🚫 Ban User"],
    ["✅ Unban User"],
  ]).resize();
}

// Cancel button — shown during conversational flows
export function cancelKeyboard() {
  return Markup.keyboard([["❌ Cancel"]]).resize();
}

// Remove custom keyboard
export function removeKeyboard() {
  return Markup.removeKeyboard();
}

export { KB };
