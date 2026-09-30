import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const TARGETS = [
  { name: "landing-prod", url: "https://ares1-7e1.pages.dev/" },
  { name: "game-prod", url: "https://ares1-play.pages.dev/" },
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

mkdirSync(".ci/out", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const target of TARGETS) {
  const consoleErrors = [];
  page.removeAllListeners("console");
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });

  try {
    await page.goto(target.url, { waitUntil: "networkidle", timeout: 60000 });
  } catch (error) {
    consoleErrors.push(`goto: ${String(error).slice(0, 200)}`);
  }
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `.ci/out/${target.name}-viewport.png` });
  await page.screenshot({ path: `.ci/out/${target.name}-full.png`, fullPage: true });

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
        const image = style.backgroundImage;
        if (image && image !== "none") return null;
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
          className: element.className?.toString?.().slice(0, 120) ?? "",
          textLength: text.length,
          textHead: text.slice(0, 90),
          rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
          opacity: style.opacity,
          visibility: style.visibility,
          display: style.display,
          overflow: style.overflow,
          height: style.height,
          color: style.color,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage.slice(0, 120),
          mixBlendMode: style.mixBlendMode,
          zIndex: style.zIndex,
          position: style.position,
          transform: style.transform.slice(0, 60),
          contrast: bg && fg ? Math.round(contrast(fg, bg) * 100) / 100 : null,
          bgUsed: bg ? `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` : "art/none",
        });
      }
    }

    const reveals = [...document.querySelectorAll("[data-liquid-panel]")].map((element) => {
      const style = getComputedStyle(element);
      return {
        className: element.className?.toString?.().slice(0, 80) ?? "",
        opacity: style.opacity,
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage.slice(0, 80),
        height: style.height,
        overflow: style.overflow,
      };
    });

    return {
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight },
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      panels,
      reveals,
    };
  }, PANEL_SELECTORS);

  report.consoleErrors = consoleErrors;
  writeFileSync(`.ci/out/${target.name}.json`, JSON.stringify(report, null, 2));
  if (target.name === "landing-prod") {
    // Sections screenshots: capture each section with panels for close inspection.
    const sections = await page.evaluate(() =>
      [...document.querySelectorAll("section[id], section")].map((element, index) => ({
        index,
        id: element.id || `section-${index}`,
      })),
    );
    for (const section of sections.slice(0, 12)) {
      try {
        await page.locator(`section >> nth=${section.index}`).screenshot({
          path: `.ci/out/landing-${section.id}.png`,
          timeout: 15000,
        });
      } catch {
        /* section may be off-screen; skip */
      }
    }
  }
}

await browser.close();
console.log("done");
