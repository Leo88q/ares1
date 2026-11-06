# `@ares/colony-engine` — детерминированный движок колонии

Этот пакет — единственный источник правил колонии. Его импортируют и браузер
(web, `apps/web`), и сервер (backend, `apps/backend`). Одинаковый журнал
действий должен давать одинаковое состояние в обоих местах; это проверяется
тестами `test/determinism.test.mjs`.

## Состав

- `src/` — исходники TypeScript (перенесены из `apps/web/src` через `git mv`,
  история файлов сохранена). Внутренние импорты написаны с расширением `.js`
  (схема `NodeNext`), чтобы один и тот же код работал в Node ESM и в сборщике web.
- `lib/esm/` и `lib/types/` — собранный JS и типы. **Коммитятся в git**, как у
  `solana-buffer-layout-utils`: CI и Docker не собирают пакет, а берут готовое.
- `exports: "./*"` → `lib/esm/*.js` и `lib/types/*.d.ts`. Пример:
  `import { advanceDays } from '@ares/colony-engine/colony/simulation'`.

## Что входит

Модули без зависимостей от браузера: `colony/simulation`, `colony/networks`,
`colony/layout`, `colony/deep/*` (ресурсы, устройства, экипаж, лаборатория,
энергия, отходы, рост и т. п.), `organism/{parameters,unified,beds}`.

Визуальный слой (`three`, `scene.ts`, компоненты React) в пакет не входит и
остаётся в `apps/web`.

## Сборка и проверки

```sh
cd game/apps/web/vendor/colony-engine
yarn build                 # tsc → lib/ (после любого изменения src/)
node --test test/*.test.mjs  # или из корня game/: yarn test:engine
```

`test/determinism.test.mjs` проверяет три вещи:

1. два прогона одного журнала дают одинаковый SHA-256 состояния;
2. золотой хеш (`GOLDEN_SHA256`) совпадает — при изменении правил его нужно
   обновить **и** поднять `ENGINE_VERSION`;
3. закоммиченный `lib/` совпадает с пересборкой из `src/` (иначе «lib устарел»).

## Ограничения

- Версия `0.1.0` локальная, на npm не публикуется (`private: true`).
- Нельзя добавлять в пакет `Date.now()`, `Math.random()` без seed, сетевые
  вызовы и файловый ввод-вывод: это ломает детерминизм.
- Для случайности используется `deep/rng.ts` с явным seed.
