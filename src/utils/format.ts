export const EMOJI = {
  welcome: "👋",
  alive: "✨",
  join: "📩",
  approve: "✅",
  decline: "❌",
  autoApprove: "⚡",
  broadcast: "📢",
  stats: "📊",
  relay: "💬",
  config: "⚙️",
  admin: "🛡️",
  user: "👤",
  link: "🔗",
  info: "ℹ️",
  error: "⚠️",
  success: "🟢",
  failed: "🔴",
  pending: "🟡",
  clock: "🕓",
} as const;

export const F = {
  bold: (s: string) => `*${s}*`,
  italic: (s: string) => `_${s}_`,
};

export const parseMode: { parse_mode: string } = { parse_mode: "Markdown" };
