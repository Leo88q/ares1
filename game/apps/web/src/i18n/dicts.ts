// Словари всех языков + инициализация ядра i18n.
// RU-словарь не нужен: ключ = оригинальная русская строка, t() возвращает её как есть.
import en from './strings/en';
import ptBR from './strings/pt-BR';
import es419 from './strings/es-419';
import vi from './strings/vi';
import id from './strings/id';
import tl from './strings/tl';
import { initI18n } from './index';

initI18n({
  en,
  'pt-BR': ptBR,
  'es-419': es419,
  vi,
  id,
  tl,
});
