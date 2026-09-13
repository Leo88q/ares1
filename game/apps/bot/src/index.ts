import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in apps/bot/.env");
  process.exit(1);
}
if (!webAppUrl) {
  console.error("Set WEB_APP_URL in apps/bot/.env");
  process.exit(1);
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  const refPayload = ctx.match?.toString().trim();
  const url = refPayload ? `${webAppUrl}?startapp=${encodeURIComponent(refPayload)}` : webAppUrl;

  const keyboard = new InlineKeyboard().webApp("🥔 Открыть Solana Potato", url!);
  await ctx.reply(
    "Добро пожаловать в Solana Potato! Выращивай картофель, собирай урожай и торгуй на маркетплейсе.",
    { reply_markup: keyboard }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "/start — открыть игру\n" +
    "Награды за задания (подписка, ежедневный чек-ин, ачивки) начисляются только через защищённый сервер и видны во вкладке Профиль."
  );
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start({
  onStart: (botInfo) => {
    console.log("Bot started as @" + botInfo.username);
  },
});
