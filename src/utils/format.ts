import { Markup } from "telegraf";

const KB = "Markdown" as const;

// Escape special characters for Telegram MarkdownV2/Markdown
export function esc(s: string): string {
  return s.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}

// User main keyboard — reply buttons at bottom
export function userMainKeyboard() {
  return Markup.keyboard([
    ["📋 Help"],
    ["🔗 Rejoin", "👤 My Info"],
    ["💬 Message Admin"],
  ]).resize();
}

// Admin main keyboard
export function adminMainKeyboard() {
  return Markup.keyboard([
    ["📊 Stats", "📢 Broadcast"],
    ["⚡ Auto Approve", "🔍 Bcast Status"],
    ["➕ Add Admin", "➖ Remove Admin"],
    ["👥 List Admins", "⚙️ Config"],
    ["📍 Set Channel", "🔗 Set Link"],
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
