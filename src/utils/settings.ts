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

export async function getWelcomeMessage(): Promise<string | null> {
  return getSetting("welcome_message");
}

export async function setWelcomeMessage(msg: string) {
  await setSetting("welcome_message", msg);
}

export async function getFolderLink(): Promise<string | null> {
  return getSetting("folder_link");
}

export async function setFolderLink(link: string) {
  await setSetting("folder_link", link);
}
