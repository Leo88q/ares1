import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync(".ci/out", { recursive: true });
const out = [];
const browser = await chromium.launch();

const GAME = "https://arena-01a0efbd-ares1.ares1-play.pages.dev/";
const LANDING = "https://arena-01a0efbd-ares1.ares1-7e1.pages.dev/";

function log(line) {
  out.push(line);
}

async function dismissCookies(page) {
  for (const label of ["Accept all", "Принять все", "Reject all", "Отклонить все"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    try {
      if ((await button.count()) > 0) {
        await button.first().click({ timeout: 2500 });
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      /* no banner */
    }
  }
}

async function scrollAll(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let index = 0; index <= 24; index += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((height / 24) * index));
    await page.waitForTimeout(110);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function dump(page, selector, label) {
  const rows = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].slice(0, 4).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return `${element.className?.toString?.().slice(0, 55)} | border=${style.borderTopWidth} ${style.borderTopStyle} bi=${String(style.borderImageSource).slice(0, 42)} pad=${style.padding} radius=${style.borderRadius} bg=${style.backgroundColor} z=${style.zIndex} rect=${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
  }, selector);
  log(`--- ${label} (${rows.length})`);
  for (const row of rows) log(`    ${row}`);
}

// ---------- GAME ----------
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  await page.goto(GAME, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);
  await page.waitForSelector(".pf-card, .mk-skel", { timeout: 45000 }).catch(() => log("!! card surfaces never appeared"));
  for (let step = 0; step < 8; step += 1) {
    let clicked = false;
    for (const label of ["Next", "Далее", "Skip", "Пропустить"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
        await button.first().click({ timeout: 2000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(400);
        break;
      }
    }
    if (!clicked) break;
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: ".ci/out/game-main.jpg", type: "jpeg", quality: 60 });

  log("=== GAME: kit/MK rules in the loaded CSS ===");
  log(await page.evaluate(() => {
    const lines = [];
    for (const sheet of document.styleSheets) {
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = (rule.selectorText || "").trim();
        if (/^\.k-panel\b|^\.pf-card\b|^\.k-skel\b/.test(sel)) lines.push(`${sel} { ${rule.style.cssText.slice(0, 90)} }`);
      }
    }
    return lines.join("\n");
  }));

  log("=== GAME: computed surfaces ===");
  await dump(page, ".pf-card", "pf-card");
  await dump(page, ".k-skel, .mk-skel", "skeleton");
  log(await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "k-skel";
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const result = `.k-skel probe: radius=${style.borderRadius} border=${style.borderTopWidth} ${style.borderTopColor} bg=${style.backgroundColor}`;
    probe.remove();
    return result;
  }));

  // language popup
  try {
    const index = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      return buttons.findIndex((b) => /language|язык/i.test(b.getAttribute("aria-label") || b.textContent || ""));
    });
    if (index >= 0) {
      await page.locator("button").nth(index).click({ timeout: 4000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: ".ci/out/game-lang-popup.jpg", type: "jpeg", quality: 70 });
      log(await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"]');
        if (!menu) return "lang menu: NOT FOUND";
        const style = getComputedStyle(menu);
        return `lang menu: z=${style.zIndex} bg=${style.backgroundColor} border=${style.borderTopWidth} ${style.borderTopColor} shadow=${style.boxShadow.slice(0, 55)}`;
      }));
    } else {
      log("lang button not found");
    }
  } catch (error) {
    log(`lang popup error: ${String(error).slice(0, 140)}`);
  }
  await page.close();
} catch (error) {
  log(`GAME BLOCK FAILED: ${String(error).slice(0, 300)}`);
}

// ---------- LANDING ----------
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(LANDING, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);
  await scrollAll(page);
  log("=== LANDING: surfaces (палитра после чистки) ===");
  await dump(page, ".pack-buy-main", "pack-buy-main (кнопка покупки модуля)");
  await dump(page, ".morph-control", "morph-control");
  await dump(page, ".xp-hud", "XP HUD");
  await page.screenshot({ path: ".ci/out/landing-full.jpg", type: "jpeg", quality: 50, fullPage: true });
  await page.close();
} catch (error) {
  log(`LANDING BLOCK FAILED: ${String(error).slice(0, 300)}`);
}

writeFileSync(".ci/out/checks.txt", out.join("\n"));
console.log(out.join("\n"));
await browser.close();
