/**
 * i18n ядро: язык хранится в module-level сторе (доступно из контекстов/хуков
 * без React), React-реактивность — через useSyncExternalStore.
 * Английский — базовый язык: отсутствующий ключ падает на английский словарь.
 */
import { useSyncExternalStore } from "react";

export type Lang = "en" | "ru" | "pt-BR" | "es-419" | "vi" | "id" | "tl";

export interface LangMeta {
  readonly code: Lang;
  readonly label: string; // на английском
  readonly native: string; // на родном языке
}

export const LANGS: readonly LangMeta[] = [
  { code: "en", label: "English", native: "English" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "pt-BR", label: "Portuguese (Brazil)", native: "Português (Brasil)" },
  { code: "es-419", label: "Spanish (LatAm)", native: "Español (Latinoamérica)" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "tl", label: "Filipino", native: "Filipino" },
];

const STORAGE_KEY = "ares1_lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved as Lang;
  } catch {
    /* приватный режим */
  }
  const nav = (navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"]
  )
    .map((s: string) => s.toLowerCase())
    .find((s: string) =>
      [
        s.startsWith("en"),
        s.startsWith("ru"),
        s.startsWith("pt"),
        s.startsWith("es"),
        s.startsWith("vi"),
        s.startsWith("id") || s.startsWith("ms"),
        s.startsWith("tl") || s.startsWith("fil"),
      ].some(Boolean),
    );
  if (!nav) return "en";
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("es")) return "es-419";
  if (nav.startsWith("vi")) return "vi";
  if (nav.startsWith("id") || nav.startsWith("ms")) return "id";
  if (nav.startsWith("tl") || nav.startsWith("fil")) return "tl";
  return "en";
}

let dicts: Record<Lang, Record<string, string>> = {
  en: {},
  ru: {},
  "pt-BR": {},
  "es-419": {},
  vi: {},
  id: {},
  tl: {},
};

export function initI18n(all: Partial<Record<Lang, Record<string, string>>>): void {
  dicts = { ...dicts, ...all };
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang === "es-419" ? "es" : lang;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Перевод ключа. Ключ — исходная русская строка (RU = базовый язык UI,
 * словарь не нужен: для ru ключ возвращается как есть).
 * Фолбэк: текущий язык -> английский -> сам ключ.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const table = current === "ru" ? {} : (dicts[current] || {});
  const en = dicts.en || {};
  let s = table[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

interface PluralForms {
  one: string;
  few?: string; // для языков с формами «немного» (русская)
  many: string;
}

/**
 * Выбор формы слова по числу: для ru — полноценная трёхчастная модель
 * (один/несколько/много), для остальных языков — one/many.
 */
export function plural(n: number, f: PluralForms): string {
  if (current === "ru") {
    const abs = Math.abs(Math.trunc(n));
    const d = abs % 10;
    const dd = abs % 100;
    if (d === 1 && dd !== 11) return f.one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return f.few ?? f.many;
    return f.many;
  }
  return n === 1 ? f.one : f.many;
}

export interface I18n {
  readonly lang: Lang;
  readonly setLang: (l: Lang) => void;
  readonly t: typeof t;
  readonly plural: typeof plural;
}

export function useI18n(): I18n {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, setLang: setLang, t, plural };
}
