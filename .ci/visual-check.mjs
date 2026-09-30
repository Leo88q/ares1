import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync(".ci/out", { recursive: true });
const out = [];
const browser = await chromium.launch();

async function dismissCookies(page) {
  for (const label of ["Accept all", "Принять все", "Reject all"]) {
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

async function dump(page, selector, label) {
  const data = await page.evaluate((sel) => {
    const styles = [...document.querySelectorAll(sel)].slice(0, 4).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: element.className?.toString?.().slice(0, 70),
        padding: style.padding,
        border: style.border,
        borderImage: style.borderImageSource,
        background: style.background.slice(0, 90),
        radius: style.borderRadius,
        shadow: style.boxShadow.slice(0, 70),
        opacity: style.opacity,
        zIndex: style.zIndex,
        rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @${Math.round(rect.top)}`,
      };
    });
    return styles;
  }, selector);
  out.push(`--- ${label} (${data.length})`);
  for (const entry of data) out.push(`    ${JSON.stringify(entry)}`);
}

// ---------- GAME ----------
{
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  await page.goto("https://arena-01a0efbd-ares1.ares1-play.pages.dev/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await dismissCookies(page);
  // skip the tutorial if it is on screen
  for (const label of ["Next", "Далее", "Skip", "Пропустить"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    try {
      if ((await button.count()) > 0) {
        await button.first().click({ timeout: 1500 });
        await page.waitForTimeout(300);
      }
    } catch {
      /* keep going */
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: ".ci/out/game-before.jpg", type: "jpeg", quality: 60 });
  out.push("=== GAME: card surfaces ===");
  await dump(page, ".pf-card", "pf-card");
  await dump(page, ".k-panel", "k-panel");
  await dump(page, '[data-ares-hull="true"]', "hull host");

  // language popup
  const langButton = page.getByRole("button", { name: /Язык|Language|English/i }).first();
  try {
    if ((await langButton.count()) > 0) {
      await langButton.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: ".ci/out/game-lang-popup-before.jpg", type: "jpeg", quality: 65 });
      await dump(page, '[role="menu"]', "lang popup (role=menu)");
    } else {
      out.push("lang button not found");
    }
  } catch (error) {
    out.push(`lang popup error: ${String(error).slice(0, 120)}`);
  }
  await page.close();
}

// ---------- LANDING ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("https://arena-01a0efbd-ares1.ares1-7e1.pages.dev/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);
  out.push("=== LANDING: leftovers ===");
  await dump(page, ".pack-buy-main", "pack-buy-main (магазин модулей)");
  await dump(page, ".morph-control", "morph-control");
  const focus = await page.evaluate(() => {
    const control = document.querySelector(".morph-control");
    if (!control) return "no morph-control";
    control.focus();
    const style = getComputedStyle(control);
    return `outline=${style.outline} outlineColor=${style.outlineColor}`;
  });
  out.push(`morph-control:focus-visible -> ${focus}`);
  await page.close();
}

writeFileSync(".ci/out/checks.txt", out.join("\n"));
console.log(out.join("\n"));
await browser.close();
