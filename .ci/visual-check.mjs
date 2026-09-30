import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const TARGETS = [
  { name: "post45-prod", url: "https://ares1-7e1.pages.dev/" },
  { name: "pre45-preview", url: "https://44f63419.ares1-7e1.pages.dev/" },
];

const PANEL_SELECTORS = [
  ".panel",
  ".feature-card",
  ".comparison",
  ".tier-panel",
  ".colony-manual",
  ".waitlist-panel",
  ".presale-panel",
  ".cycle-panel",
  ".live-stat",
  ".deflation-panel",
  ".packs-panel",
];

const SECTION_SHOTS = [
  ".problem-grid",
  ".feature-grid",
  ".tier-panel",
  ".live-stats-grid",
  ".waitlist-panel",
  ".presale-panel",
  ".packs-panel",
  ".colony-manual",
  ".tokenomics-grid",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(".ci/out", { recursive: true });
const summary = [];

async function acceptCookies(page) {
  for (const label of ["Accept all", "Принять все", "Reject all", "Отклонить все"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    try {
      if ((await button.count()) > 0) {
        await button.first().click({ timeout: 3000 });
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      /* banner may be absent */
    }
  }
}

async function scrollThrough(page, steps = 26) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let index = 0; index <= steps; index += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((height / steps) * index));
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();

for (const target of TARGETS) {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
    });

    try {
      await page.goto(target.url, { waitUntil: "networkidle", timeout: 60000 });
    } catch (error) {
      consoleErrors.push(`goto: ${String(error).slice(0, 160)}`);
    }
    await page.waitForTimeout(1500);
    await acceptCookies(page);
    await scrollThrough(page);

    const tag = `${target.name}-${viewport.name}`;
    await page.screenshot({ path: `.ci/out/${tag}-top.jpg`, type: "jpeg", quality: 65 });
    await page.screenshot({ path: `.ci/out/${tag}-full.jpg`, type: "jpeg", quality: 55, fullPage: true });

    const report = await page.evaluate((selectors) => {
      function parseColor(value) {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(",").map((piece) => parseFloat(piece));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      }
      function luminance({ r, g, b }) {
        const channel = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      }
      function contrast(fg, bg) {
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      function effectiveBackground(element) {
        let node = element;
        while (node && node !== document.documentElement) {
          const style = getComputedStyle(node);
          const color = parseColor(style.backgroundColor);
          if (color && color.a > 0.5) return color;
          if (style.backgroundImage && style.backgroundImage !== "none") return null;
          node = node.parentElement;
        }
        const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor);
        return bodyColor && bodyColor.a > 0.5 ? bodyColor : { r: 5, g: 3, b: 8, a: 1 };
      }

      const panels = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const text = (element.textContent || "").replace(/\s+/g, " ").trim();
          const bg = effectiveBackground(element);
          const fg = parseColor(style.color);
          panels.push({
            selector,
            className: element.className?.toString?.().slice(0, 90) ?? "",
            textLength: text.length,
            rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            opacity: style.opacity,
            overflow: style.overflow,
            height: style.height,
            color: style.color,
            bg: style.backgroundColor,
            bgImage: style.backgroundImage.slice(0, 80),
            contrast: bg && fg ? Math.round(contrast(fg, bg) * 100) / 100 : null,
            bgUsed: bg ? `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` : "art",
            text: text.slice(0, 60),
          });
        }
      }

      const invisible = [...document.querySelectorAll("[data-liquid-panel], h2, h3, p")].map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className?.toString?.().slice(0, 70) ?? "",
          opacity: style.opacity,
          transform: style.transform.slice(0, 40),
          height: Math.round(rect.height),
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
        };
      }).filter((entry) => entry.text.length > 3 && (entry.opacity === "0" || entry.height < 2));

      return {
        title: document.title,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        panels,
        invisible,
      };
    }, PANEL_SELECTORS);

    report.consoleErrors = consoleErrors;
    writeFileSync(`.ci/out/${tag}.json`, JSON.stringify(report, null, 2));

    summary.push(`=== ${tag} (${target.url}) ===`);
    summary.push(`title: ${report.title} | console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
    for (const panel of report.panels) {
      summary.push(
        `panel ${panel.selector} [${panel.className}] ${panel.rect} op=${panel.opacity} overflow=${panel.overflow} h=${panel.height} color=${panel.color} bg=${panel.bg} bgImage=${panel.bgImage} contrast=${panel.contrast} bgUsed=${panel.bgUsed} text="${panel.text}"`,
      );
    }
    summary.push(`-- still invisible after scroll: ${report.invisible.length}`);
    for (const entry of report.invisible) {
      summary.push(`   ${entry.tag}.${entry.className} opacity=${entry.opacity} h=${entry.height} "${entry.text}"`);
    }

    if (viewport.name === "desktop") {
      for (const selector of SECTION_SHOTS) {
        const locator = page.locator(selector).first();
        try {
          if ((await locator.count()) > 0) {
            await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
            await page.waitForTimeout(400);
            await locator.screenshot({
              path: `.ci/out/${tag}-${selector.replace(/[^a-z0-9]+/gi, "-")}.jpg`,
              type: "jpeg",
              quality: 65,
              timeout: 15000,
            });
          }
        } catch (error) {
          summary.push(`section shot ${selector} failed: ${String(error).slice(0, 100)}`);
        }
      }
    }

    await page.close();
  }
}

writeFileSync(".ci/out/summary.txt", summary.join("\n"));
console.log(summary.join("\n"));
await browser.close();
