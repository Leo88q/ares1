// Компактный селектор языка для шапки лендинга: глобус + выпадающий список.
import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { LANGS, useI18n, t } from "./index";

export function LangSwitcher(): JSX.Element {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANGS.find((l) => l.code === lang);

  return (
    <div className="lang-switcher" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("Язык")}
        aria-expanded={open}
        className="lang-switcher__button"
      >
        <Globe size={15} aria-hidden="true" />
        <span>{(current?.label || "English").split(" ")[0]?.toUpperCase().slice(0, 6) ?? "EN"}</span>
      </button>
      {open && (
        <div className="lang-switcher__menu" role="menu">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === lang}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className={l.code === lang ? "lang-switcher__item lang-switcher__item--active" : "lang-switcher__item"}
            >
              <span>{l.native}</span>
              {l.code === lang && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
