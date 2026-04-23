import { Markup } from "telegraf";

const KB = "Markdown" as const;

export function esc(s: string): string {
  return s.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}

export function userMainKeyboard() {
  return Markup.keyboard([
    ["📁 Join Channels", "💬 Message Admin"],
  ]).resize();
}

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

export function cancelKeyboard() {
  return Markup.keyboard([["❌ Cancel"]]).resize();
}

export function removeKeyboard() {
  return Markup.removeKeyboard();
}

export { KB };