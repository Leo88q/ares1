import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env.js";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

declare global {
  namespace Express {
    interface Request {
      telegramUser?: TelegramUser;
    }
  }
}

const MAX_AUTH_AGE_SECONDS = 24 * 3600;

function verifyInitData(initData: string, botToken: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs: string[] = [];
  params.forEach((value, key) => pairs.push(`${key}=${value}`));
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    if (!user.id) return null;
    return user;
  } catch {
    return null;
  }
}

export function telegramAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const initData = req.header("X-Telegram-Init-Data");
  if (!initData) {
    return res.status(401).json({ error: "Missing X-Telegram-Init-Data header" });
  }
  const user = verifyInitData(initData, env.telegramBotToken);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired Telegram auth" });
  }
  req.telegramUser = user;
  next();
}
