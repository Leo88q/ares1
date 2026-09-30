import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync(".ci/out", { recursive: true });
const out = [];
const browser = await chromium.launch();

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
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function tapThrough(page) {
  for (let step = 0; step < 10; step += 1) {
    let clicked = false;
    for (const label of ["Next", "Далее", "Skip", "Пропустить", "Начать", "Start", "Понятно"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      try {
        const count = await button.count();
        if (count > 0 && (await button.first().isVisible())) {
          await button.first().click({ timeout: 2000 });
          clicked = true;
          await page.waitForTimeout(450);
          break;
        }
      } catch {
        /* try next label */
      }
    }
    if (!clicked) break;
  }
}

const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
await page.goto("https://arena-01a0efbd-ares1.ares1-play.pages.dev/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
await dismissCookies(page);
try {
  await page.waitForSelector(".pf-card, .mk-panel, .mk-skel", { timeout: 45000 });
} catch {
  out.push("!! game never rendered card surfaces in 45s");
}
await tapThrough(page);
await page.waitForTimeout(2500);
await page.screenshot({ path: ".ci/out/game-farm.jpg", type: "jpeg", quality: 60 });

out.push("=== GAME: where .pf-card / .k-* come from ===");
out.push(await page.evaluate(() => {
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
      const sel = rule.selectorText || "";
      if (/^\.pf-card\b|^\.k-panel\b|^\.glass\b|^\.k-key\b/.test(sel.trim())) {
        lines.push(`${sel} { ${rule.style.cssText.slice(0, 110)} }`);
      }
    }
  }
  return lines;
}));

out.push("=== GAME: computed surfaces ===");
out.push(await page.evaluate(() => {
  const pick = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return `${element.className?.toString?.().slice(0, 55)} | pad=${style.padding} border=${style.borderTopWidth}/${style.borderTopStyle} bi=${style.borderImageSource} bg=${style.backgroundColor} radius=${style.borderRadius} rect=${Math.round(rect.width)}x${Math.round(rect.height)}`;
  };
  const first = document.querySelector(".pf-card");
  const skull = document.querySelector(".mk-skel");
  return [
    `pf-card n=${document.querySelectorAll(".pf-card").length} :: ${pick(first)}`,
    `mk-skel n=${document.querySelectorAll(".mk-skel").length} :: ${pick(skull)}`,
    `k-panel n=${document.querySelectorAll(".k-panel").length}`,
  ];
}));

out.push("=== GAME: stylesheet list ===");
out.push(await page.evaluate(() => [...document.styleSheets].map((sheet) => (sheet.href || "inline").split("/").slice(-1)[0]).join(", ")));

out.push("=== GAME: after-fix surfaces ===");
await dump(page, ".k-panel", "k-panel");
await dump(page, ".pf-card", "pf-card");

// language popup
try {
  const candidates = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((button, index) => ({
      index,
      label: (button.getAttribute("aria-label") || button.textContent || "").trim().slice(0, 30),
      expanded: button.getAttribute("aria-expanded"),
    })).filter((entry) => /язык|language|english|русск|england|globe/i.test(entry.label) || entry.expanded !== null),
  );
  out.push(`lang candidates: ${JSON.stringify(candidates)}`);
  if (candidates.length > 0) {
    const locator = page.locator("button").nth(candidates[0].index);
    await locator.click({ timeout: 4000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: ".ci/out/game-lang-popup.jpg", type: "jpeg", quality: 65 });
    out.push(await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      if (!menu) return "menu not found";
      const style = getComputedStyle(menu);
      return `menu: z=${style.zIndex} bg=${style.backgroundColor} border=${style.border} shadow=${style.boxShadow} radius=${style.borderRadius}`;
    }));
  }
} catch (error) {
  out.push(`lang popup error: ${String(error).slice(0, 150)}`);
}

// profile / market screen for cards
for (const [label, path] of [["profile", "/profile"], ["market", "/market"]]) {
  try {
    await page.goto(`https://arena-01a0efbd-ares1.ares1-play.pages.dev${path}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `.ci/out/game-${label}.jpg`, type: "jpeg", quality: 60 });
    out.push(`${label}: pf-card=${await page.locator(".pf-card").count()} png=${await page.locator("img").count()}`);
  } catch (error) {
    out.push(`${label}: ${String(error).slice(0, 120)}`);
  }
}

await page.close();

// ---------- LANDING: leftovers after the palette sweep ----------
{
  const landingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await landingPage.goto("https://arena-01a0efbd-ares1.ares1-7e1.pages.dev/", { waitUntil: "networkidle", timeout: 60000 });
  await landingPage.waitForTimeout(1500);
  await dismissCookies(landingPage);
  await scrollAll(landingPage);
  out.push("=== LANDING: surfaces after palette sweep ===");
  await dump(landingPage, ".pack-buy-main", "pack-buy-main (кнопка покупки модуля)");
  await dump(landingPage, ".morph-control", "morph-control");
  await dump(landingPage, ".xp-hud", "XP HUD");
  out.push(await landingPage.evaluate(() => {
    const control = document.querySelector(".morph-control");
    if (!control) return "no morph-control";
    return `focus-visible color -> ${getComputedStyle(control).outlineColor}`;
  }));
  await landingPage.screenshot({ path: ".ci/out/landing-after.jpg", type: "jpeg", quality: 60, fullPage: true });
  await landingPage.close();
}

writeFileSync(".ci/out/checks.txt", out.join("\n"));
console.log(out.join("\n"));
await browser.close();
