import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const TARGETS = [
  { name: "landing-prod", url: "https://ares1-7e1.pages.dev/" },
  { name: "landing-preview", url: "https://d57a5854.ares1-7e1.pages.dev/" },
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

const SECTION_SHOTS = [
  ".problem-grid",
  "#mechanics",
  ".tier-panel",
  ".live-stats-grid",
  ".waitlist-panel",
  ".presale-panel",
  ".packs-panel",
  ".colony-manual",
  ".tokenomics-grid",
];

mkdirSync(".ci/out", { recursive: true });

const summary = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

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
  await page.waitForTimeout(2000);

  await page.screenshot({ path: `.ci/out/${target.name}-viewport.jpg`, type: "jpeg", quality: 62 });
  await page.screenshot({ path: `.ci/out/${target.name}-full.jpg`, type: "jpeg", quality: 55, fullPage: true });

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
          className: element.className?.toString?.().slice(0, 100) ?? "",
          textLength: text.length,
          textHead: text.slice(0, 70),
          rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          opacity: style.opacity,
          visibility: style.visibility,
          overflow: style.overflow,
          height: style.height,
          color: style.color,
          bg: style.backgroundColor,
          bgImage: style.backgroundImage.slice(0, 90),
          zIndex: style.zIndex,
          position: style.position,
          contrast: bg && fg ? Math.round(contrast(fg, bg) * 100) / 100 : null,
          bgUsed: bg ? `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` : "art",
        });
      }
    }

    const reveals = [...document.querySelectorAll("[data-liquid-panel]")].map((element) => {
      const style = getComputedStyle(element);
      return {
        className: element.className?.toString?.().slice(0, 70) ?? "",
        opacity: style.opacity,
        background: style.backgroundColor,
        bgImage: style.backgroundImage.slice(0, 70),
        height: style.height,
        overflow: style.overflow,
      };
    });

    return {
      title: document.title,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      panels,
      reveals,
      hiddenText: [...document.querySelectorAll("h1,h2,h3,h4,p,li,strong,span")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const text = (element.textContent || "").trim();
          return (
            text.length > 3 &&
            (style.opacity === "0" ||
              style.visibility === "hidden" ||
              style.display === "none" ||
              rect.height < 2 ||
              rect.width < 2)
          );
        })
        .slice(0, 40)
        .map((element) => ({
          tag: element.tagName,
          className: element.className?.toString?.().slice(0, 60) ?? "",
          opacity: getComputedStyle(element).opacity,
          height: Math.round(element.getBoundingClientRect().height),
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
        })),
    };
  }, PANEL_SELECTORS);

  report.consoleErrors = consoleErrors;
  writeFileSync(`.ci/out/${target.name}.json`, JSON.stringify(report, null, 2));

  summary.push(`=== ${target.name} (${target.url}) ===`);
  summary.push(`title: ${report.title} | body bg: ${report.bodyBackground}`);
  summary.push(`console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
  for (const panel of report.panels) {
    summary.push(
      `panel ${panel.selector} [${panel.className}] ${panel.rect} op=${panel.opacity} overflow=${panel.overflow} h=${panel.height} color=${panel.color} bg=${panel.bg} bgImage=${panel.bgImage} z=${panel.zIndex} pos=${panel.position} contrast=${panel.contrast} bgUsed=${panel.bgUsed} text="${panel.textHead}"`,
    );
  }
  summary.push(`-- hidden/zero-size text nodes: ${report.hiddenText.length}`);
  for (const node of report.hiddenText) {
    summary.push(`   ${node.tag}.${node.className} opacity=${node.opacity} h=${node.height} "${node.text}"`);
  }

  if (target.name.startsWith("landing")) {
    for (const selector of SECTION_SHOTS) {
      const locator = page.locator(selector).first();
      try {
        if ((await locator.count()) > 0) {
          await locator.screenshot({
            path: `.ci/out/${target.name}-${selector.replace(/[^a-z0-9]+/gi, "-")}.jpg`,
            type: "jpeg",
            quality: 65,
            timeout: 15000,
          });
        }
      } catch (error) {
        summary.push(`section shot ${selector} failed: ${String(error).slice(0, 120)}`);
      }
    }
  }
}

writeFileSync(".ci/out/summary.txt", summary.join("\n"));
console.log(summary.join("\n"));
await browser.close();
