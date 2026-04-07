"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMenu = setupMenu;
function setupMenu(bot, adminSet) {
    // Menu button just re-shows the keyboard via /start
    bot.hears("🔄 Menu", async (ctx) => {
        await ctx.reply("📋 _Use the buttons below._", {
            parse_mode: "Markdown",
        });
    });
}
