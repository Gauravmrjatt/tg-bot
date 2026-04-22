import { Telegraf } from "telegraf";
import { getSetting, setSetting } from "./redis.js";

export let botInstance: Telegraf<any>;

export function setBotInstance(bot: Telegraf<any>) {
  botInstance = bot;
}

type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked";

interface ChannelInfo {
  chatId: string;
  title?: string;
}

const ACTIVE_STATUSES: ChatMemberStatus[] = [
  "creator",
  "administrator",
  "member",
  "restricted",
];

export async function getRequiredChannels(): Promise<ChannelInfo[]> {
  const data = await getSetting("required_channels");
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function checkUserMembership(
  userId: number,
  channelChatId: string
): Promise<boolean> {
  if (!botInstance) {
    console.error("Bot instance not set for membership check");
    return false;
  }

  try {
    const chatMember = await botInstance.telegram.getChatMember(
      channelChatId,
      userId
    );
    const status = chatMember.status;
    return ACTIVE_STATUSES.includes(status as ChatMemberStatus);
  } catch (err: any) {
    console.error(
      `Membership check failed for user ${userId} in ${channelChatId}:`,
      err.message
    );
    return false;
  }
}

export async function checkAllChannels(
  userId: number
): Promise<{ allJoined: boolean; missingChannels: ChannelInfo[] }> {
  const channels = await getRequiredChannels();
  if (channels.length === 0) {
    return { allJoined: true, missingChannels: [] };
  }

  const missing: ChannelInfo[] = [];
  for (const channel of channels) {
    const isMember = await checkUserMembership(userId, channel.chatId);
    if (!isMember) {
      missing.push(channel);
    }
  }

  return {
    allJoined: missing.length === 0,
    missingChannels: missing,
  };
}

export async function addRequiredChannel(
  chatId: string,
  title?: string
): Promise<void> {
  const channels = await getRequiredChannels();
  const exists = channels.some((c) => c.chatId === chatId);
  if (!exists) {
    channels.push({ chatId, title });
    await setSetting("required_channels", JSON.stringify(channels));
  }
}

export async function removeRequiredChannel(chatId: string): Promise<void> {
  const channels = await getRequiredChannels();
  const filtered = channels.filter((c) => c.chatId !== chatId);
  await setSetting("required_channels", JSON.stringify(filtered));
}

export async function getWelcomeMessage(): Promise<string> {
  const msg = await getSetting("welcome_message");
  return msg || "Welcome! Thanks for joining our channels.";
}

export async function setWelcomeMessage(text: string): Promise<void> {
  await setSetting("welcome_message", text);
}

export async function isUserVerified(userId: number): Promise<boolean> {
  const data = await getSetting("verified_users");
  if (!data) return false;
  try {
    const users: number[] = JSON.parse(data);
    return users.includes(userId);
  } catch {
    return false;
  }
}

export async function addVerifiedUser(userId: number): Promise<void> {
  const data = await getSetting("verified_users");
  let users: number[] = [];
  if (data) {
    try {
      users = JSON.parse(data);
    } catch {
      users = [];
    }
  }
  if (!users.includes(userId)) {
    users.push(userId);
    await setSetting("verified_users", JSON.stringify(users));
  }
}

export async function removeVerifiedUser(userId: number): Promise<void> {
  const data = await getSetting("verified_users");
  if (!data) return;
  try {
    const users: number[] = JSON.parse(data);
    const filtered = users.filter((id) => id !== userId);
    await setSetting("verified_users", JSON.stringify(filtered));
  } catch {
    // Ignore
  }
}