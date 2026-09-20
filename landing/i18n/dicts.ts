// Словари лендинга + инициализация ядра i18n.
// Ключи — оригинальные русские строки (RU = базовый язык UI): для ru словарь не нужен,
// t() возвращает ключ как есть. Английский — базовый язык для фолбэка.
import en from "./strings/en";
import ptBR from "./strings/pt-BR";
import es419 from "./strings/es-419";
import vi from "./strings/vi";
import id from "./strings/id";
import tl from "./strings/tl";
import { initI18n } from "./index";

initI18n({
  en,
  "pt-BR": ptBR,
  "es-419": es419,
  vi,
  id,
  tl,
});
