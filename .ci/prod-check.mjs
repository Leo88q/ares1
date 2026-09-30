import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync(".ci/out", { recursive: true });
const out = [];
const browser = await chromium.launch();

async function inspect(url, label, selectors = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const assets = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"], script[src], link[rel="modulepreload"]')]
        .map((el) => (el.href || el.src || "").split("/").slice(-1)[0])
        .filter(Boolean),
    );
    const markers = await page.evaluate((rules) => {
      const found = {};
      for (const [key, cssText] of Object.entries(rules)) found[key] = false;
      for (const sheet of document.styleSheets) {
        let list = null;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of list) {
          const text = (rule.cssText || "") + " ";
          for (const key of Object.keys(rules)) {
            if (text.includes(rules[key])) found[key] = true;
          }
        }
      }
      return found;
    }, selectors);
    out.push(`=== ${label} :: ${url}`);
    out.push(`    assets: ${assets.slice(0, 6).join(" | ")}`);
    out.push(`    markers: ${JSON.stringify(markers)}`);
    out.push(`    body has old marker "t('ПРОГРЕСС')": ${await page.evaluate(() => document.body.innerHTML.includes("t('ПРОГРЕСС')"))}`);
    out.push(`    crash screen: ${await page.evaluate(() => /game crashed|Cannot read properties/i.test(document.body.innerText))}`);
  } catch (error) {
    out.push(`=== ${label} FAILED: ${String(error).slice(0, 200)}`);
  }
  await page.close();
}

// Лендинг: старый неон (ff2e93) против нового (d8558f) + фикс рамки панелей.
const landingMarkers = {
  newPalette: "216, 85, 143",
  oldPalette: "255, 46, 147",
  panelFrameFix: "not(.liquid-reserved-placeholder",
};
await inspect("https://ares1-7e1.pages.dev/", "landing PROD (ares1-7e1)", landingMarkers);
await inspect("https://6aa08b50.ares1-7e1.pages.dev/", "landing build 5aa07a7 (preview)", landingMarkers);

// Игра: определяем сборку по ассету App-*.js и маркерам.
const gameMarkers = {
  gameOldCopy: "no middlemen",
  gameNewCopy: "half the market tax to the treasury",
  sPopBg: "--s-pop-bg",
};
await inspect("https://ares1-play.pages.dev/", "game PROD (ares1-play)", gameMarkers);
await inspect("https://main.ares1-play.pages.dev/", "game alias main", gameMarkers);
await inspect("https://01c6cafb.ares1-play.pages.dev/", "game build 5aa07a7 (preview)", gameMarkers);

writeFileSync(".ci/out/prod-check.txt", out.join("\n"));
console.log(out.join("\n"));
await browser.close();
