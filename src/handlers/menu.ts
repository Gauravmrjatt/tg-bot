import { Context, Telegraf } from "telegraf";
import { getSetting } from "../utils/redis.js";
import { UserModel } from "../models/index.js";

export function setupMenu(bot: Telegraf<Context>, adminSet: Set<number>) {
  // Menu button just re-shows the keyboard via /start
  bot.hears("🔄 Menu", async (ctx) => {
    await ctx.reply("📋 _Use the buttons below._", {
      parse_mode: "Markdown",
    });
  });
}
