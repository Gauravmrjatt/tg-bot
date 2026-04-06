import { getSetting, setSetting } from "./redis.js";

export async function getTargetChatId(): Promise<number | null> {
  const v = await getSetting("target_chat_id");
  return v ? parseInt(v, 10) : null;
}

export async function setTargetChatId(chatId: number) {
  await setSetting("target_chat_id", String(chatId));
}

export async function getChannelLink(): Promise<string | null> {
  return getSetting("channel_link");
}

export async function setChannelLink(link: string) {
  await setSetting("channel_link", link);
}
