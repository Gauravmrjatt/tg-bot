import { getSetting, setSetting } from "./redis.js";
import { GlobalSettingsModel } from "../models/index.js";

export async function getTargetChatId(): Promise<number | null> {
  const v = await getSetting("target_chat_id");
  if (v) return parseInt(v, 10);
  const db = await GlobalSettingsModel.findOne({ key: "targetChatId" });
  if (db?.value) {
    await setSetting("target_chat_id", String(db.value as number));
    return db.value as number;
  }
  return null;
}

export async function setTargetChatId(chatId: number) {
  await setSetting("target_chat_id", String(chatId));
  await GlobalSettingsModel.findOneAndUpdate(
    { key: "targetChatId" },
    { key: "targetChatId", value: chatId },
    { upsert: true }
  );
}

export async function getChannelLink(): Promise<string | null> {
  let v = await getSetting("channel_link");
  if (v) return v;
  const db = await GlobalSettingsModel.findOne({ key: "channelLink" });
  if (db?.value) {
    await setSetting("channel_link", db.value as string);
    return db.value as string;
  }
  return null;
}

export async function setChannelLink(link: string) {
  await setSetting("channel_link", link);
  await GlobalSettingsModel.findOneAndUpdate(
    { key: "channelLink" },
    { key: "channelLink", value: link },
    { upsert: true }
  );
}

export async function getWelcomeMessage(): Promise<string | null> {
  const v = await getSetting("welcome_message");
  if (v) return v;
  const db = await GlobalSettingsModel.findOne({ key: "welcomeMessage" });
  if (db?.value) {
    await setSetting("welcome_message", db.value as string);
    return db.value as string;
  }
  return null;
}

export async function setWelcomeMessage(msg: string) {
  await setSetting("welcome_message", msg);
  await GlobalSettingsModel.findOneAndUpdate(
    { key: "welcomeMessage" },
    { key: "welcomeMessage", value: msg },
    { upsert: true }
  );
}

export async function getFolderLink(): Promise<string | null> {
  const v = await getSetting("folder_link");
  if (v) return v;
  const db = await GlobalSettingsModel.findOne({ key: "folderLink" });
  if (db?.value) {
    await setSetting("folder_link", db.value as string);
    return db.value as string;
  }
  return null;
}

export async function setFolderLink(link: string) {
  await setSetting("folder_link", link);
  await GlobalSettingsModel.findOneAndUpdate(
    { key: "folderLink" },
    { key: "folderLink", value: link },
    { upsert: true }
  );
}
