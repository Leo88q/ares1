// Правовые страницы лендинга: /privacy и /terms должны существовать, быть
// доступными по прямой ссылке и не противоречить фактическому поведению кода.
//
// Проверяется именно связка, а не наличие файла: страница без ссылки из футера
// и баннера cookie неотличима от отсутствующей, а текст, обещающий аналитику или
// платежи, которых нет, — это уже не «нет политики», а недостоверная политика.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file://${root}/`), "utf8");

test("страницы политики и условий существуют и описаны в одном модуле", () => {
  assert.ok(existsSync(`${root}/legal.tsx`), "landing/legal.tsx must exist");
  const legal = read("legal.tsx");
  assert.match(legal, /export type LegalPage = "privacy" \| "terms"/);
  assert.match(legal, /export function legalPageFromPath/);
  assert.match(legal, /export function LegalPage/);
  // Политика обязана описывать то, что код действительно делает.
  for (const fact of [
    "IP-адрес",
    "Локальное хранилище устройства",
    "Global Privacy Control",
    "Ни аналитики, ни рекламных",
  ]) {
    assert.ok(legal.includes(fact), `privacy policy must state: ${fact}`);
  }
  // Условия обязаны говорить «не оферта» и «devnet без денежной стоимости».
  assert.match(legal, /Не оферта и не финансовый продукт/);
  assert.match(legal, /не имеют денежной стоимости/);
});

test("пути /privacy и /terms обрабатываются без роутера и открываются напрямую", () => {
  const legal = read("legal.tsx");
  // Нормализация трейлинг-слэша и регистра: /Privacy/ должен открывать то же.
  assert.match(legal, /replace\(\/\\\/\+\$\/, ""\)\.toLowerCase\(\)/);
  assert.match(legal, /normalized === "\/privacy"/);
  assert.match(legal, /normalized === "\/terms"/);
  // SPA-фолбэк отдаёт /index.html на неизвестный путь, поэтому разбор пути
  // обязан быть в самом бандле.
  assert.ok(!existsSync(`${root}/privacy/index.html`), "нет отдельного HTML: путь разбирает бандл");
});

test("ссылки на документы стоят в футере и в баннере cookie", () => {
  const app = read("App.tsx");
  assert.match(app, /legalPageFromPath\(window\.location\.pathname\)/);
  assert.match(app, /<LegalPage page=\{legalPage\} \/>/);
  assert.match(app, /<LegalNav \/>/);
  const consent = read("CookieConsent.tsx");
  assert.match(consent, /<a href="\/privacy"/, "cookie banner must link to the privacy policy");
  // Баннер не должен оставаться поверх юридической страницы модальным блокером:
  // он рендерится и там, но сама страница читается без него.
  assert.match(app, /<CookieConsent \/>/);
});

test("юридические страницы не обещают того, чего нет в коде", () => {
  const legal = read("legal.tsx");
  const source = `${read("App.tsx")}\n${read("CookieConsent.tsx")}\n${read("utils/consent.ts")}`;
  // Трекеров нет — политика это утверждает; проверяем, что их и правда нет.
  for (const tracker of ["google-analytics", "googletagmanager", "plausible.io", "posthog"]) {
    assert.equal(source.includes(tracker), false, `политика утверждает «нет аналитики», но найден ${tracker}`);
  }
  // Реквизиты и юрисдикция не выдуманы: текст прямо говорит, что это описание
  // кода, а не заключение юриста.
  assert.match(legal, /не юридическое заключение/);
  assert.match(legal, /docs\/LEGAL_REVIEW\.md/);
});

test("юридическое ревью зафиксировано как обязательный шаг запуска", () => {
  const review = readFileSync(`${root}/../docs/LEGAL_REVIEW.md`, "utf8");
  for (const item of ["Что уже сделано", "Что должен проверить юрист", "Стоп-условия"]) {
    assert.ok(review.includes(item), `docs/LEGAL_REVIEW.md must contain: ${item}`);
  }
  const workflow = readFileSync(`${root}/../.github/workflows/security.yml`, "utf8");
  assert.match(workflow, /docs\/LEGAL_REVIEW\.md/);
});
