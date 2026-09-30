import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const TARGETS = [
  { name: "post45-prod", url: "https://ares1-7e1.pages.dev/" },
  { name: "pre45-preview", url: "https://44f63419.ares1-7e1.pages.dev/" },
];

mkdirSync(".ci/out", { recursive: true });
const summary = [];

const browser = await chromium.launch();
for (const target of TARGETS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failures = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => failures.push(`FAILED ${request.url()} ${request.failure()?.errorText ?? ""}`));

  await page.goto(target.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const rules = [];
    let styleSheetCount = 0;
    let totalRules = 0;
    let hasHullFrameRule = false;
    let hasAresHullHostRule = false;
    let hasAresHullSvgRule = false;

    for (const sheet of document.styleSheets) {
      styleSheetCount += 1;
      let cssRules = null;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of cssRules) {
        totalRules += 1;
        const text = rule.cssText || "";
        if (text.includes(".ares-hull-frame")) hasHullFrameRule = true;
        if (text.includes('[data-ares-hull="true"][data-liquid-panel]')) hasAresHullHostRule = true;
        if (text.includes(".ares-hull-svg")) hasAresHullSvgRule = true;
        if (rules.length < 40 && (rule instanceof CSSStyleRule) && /\bar(es)-hull|feature-card|tier-panel|liquid-panel/.test(rule.selectorText)) {
          rules.push(rule.cssText.slice(0, 260));
        }
      }
    }

    function describe(element) {
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: element.className?.toString?.().slice(0, 90) ?? "",
        position: style.position,
        inset: `${style.top} ${style.right} ${style.bottom} ${style.left}`,
        display: style.display,
        width: style.width,
        height: style.height,
        zIndex: style.zIndex,
        rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @${Math.round(rect.top)}`,
      };
    }

    const card = document.querySelector(".feature-card");
    const cardTree = card
      ? [...card.querySelectorAll("*")].slice(0, 18).map((element) => describe(element))
      : [];

    return {
      styleSheetCount,
      totalRules,
      hasHullFrameRule,
      hasAresHullHostRule,
      hasAresHullSvgRule,
      frames: [...document.querySelectorAll(".ares-hull-frame")].slice(0, 3).map((element) => describe(element)),
      svgs: [...document.querySelectorAll(".ares-hull-svg")].slice(0, 3).map((element) => describe(element)),
      card: describe(card),
      cardTree,
      matchedRules: rules,
      hasDataAresHull: document.querySelectorAll('[data-ares-hull="true"]').length,
    };
  });

  report.failures = failures;
  writeFileSync(`.ci/out/${target.name}-layout.json`, JSON.stringify(report, null, 2));

  summary.push(`=== ${target.name} ===`);
  summary.push(`styleSheets=${report.styleSheetCount} rules=${report.totalRules} hullFrameRule=${report.hasHullFrameRule} hullHostRule=${report.hasAresHullHostRule} hullSvgRule=${report.hasAresHullSvgRule} dataAresHullCount=${report.hasDataAresHull}`);
  summary.push(`failures: ${failures.length ? failures.join(" | ") : "none"}`);
  summary.push(`card: ${JSON.stringify(report.card)}`);
  for (const node of report.cardTree) {
    summary.push(`   tree ${node.tag}.${node.className} pos=${node.position} inset=${node.inset} ${node.rect} ${node.width}x${node.height}`);
  }
  for (const node of report.frames) summary.push(`   frame ${JSON.stringify(node)}`);
  for (const node of report.svgs) summary.push(`   svg ${JSON.stringify(node)}`);
  summary.push("-- matched rules --");
  for (const rule of report.matchedRules) summary.push(`   ${rule}`);

  await page.close();
}

writeFileSync(".ci/out/layout-summary.txt", summary.join("\n"));
console.log(summary.join("\n"));
await browser.close();
