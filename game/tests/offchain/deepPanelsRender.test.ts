import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactNS from 'react'

// `apps/web` собирается с автоматическим JSX-рантаймом (`jsx: react-jsx`), а
// этот прогон идёт через корневой tsconfig, где JSX классический. Компонент
// править из-за теста не надо — достаточно дать ему `React` в области видимости.
;(globalThis as unknown as { React: unknown }).React = ReactNS

import { DeepPanels, DEEP_TABS, nextTab, type DeepTab } from '../../apps/web/src/colony/DeepPanels'
import { createWorldForColony } from '../../apps/web/src/colony/deep/bridge'
import { advanceDay, initialColony } from '../../apps/web/src/colony/simulation'

/**
 * Панели глубокого слоя должны собираться из настоящего мира, а не из заглушек:
 * мир, прошедший хотя бы один сол, уже содержит экипаж, склады, месторождения,
 * секции и грядки, и всё это обязано появиться в разметке.
 */
const worldAfterOneSol = () => {
  const state = advanceDay(initialColony(), { sunHours: 18, waterRecovery: 0.94 })
  const world = state.world ?? createWorldForColony(state)
  assert.ok(world, 'deep world must exist after one sol')
  return world
}

const markup = (
  world: ReturnType<typeof worldAfterOneSol> | null,
  language: string,
  initialTab: DeepTab = 'crew',
) => renderToStaticMarkup(createElement(DeepPanels, { world, language, onChange: () => {}, initialTab }))

test('the panel renders every tab in both languages', () => {
  for (const language of ['ru', 'en']) {
    const html = markup(null, language)
    assert.ok(html.includes('data-testid="deep-panels"'))
    for (const tab of ['crew', 'tasks', 'stores', 'extraction', 'life', 'greenhouse', 'lab', 'repair', 'contracts', 'journal']) {
      assert.ok(html.includes(`data-testid="deep-tab-${tab}"`), `${language}: missing tab ${tab}`)
    }
    assert.ok(html.includes('data-testid="deep-empty"'), `${language}: empty state missing`)
  }
})

test('a real world fills the crew, deposits, sections and beds', () => {
  const world = worldAfterOneSol()
  assert.ok(world.crew.length > 0, 'the world must have a crew')
  const crewHtml = markup(world, 'ru', 'crew')
  for (const member of world.crew) {
    assert.ok(crewHtml.includes(`data-testid="deep-crew-${member.id}"`), `crew row missing for ${member.id}`)
  }

  assert.ok(world.deposits.length > 0, 'the world must have deposits')
  const depositHtml = markup(world, 'ru', 'extraction')
  for (const deposit of world.deposits) {
    assert.ok(depositHtml.includes(`data-testid="deep-deposit-${deposit.id}"`), `deposit row missing for ${deposit.id}`)
  }

  assert.ok(world.sections.length > 0, 'the world must have sections')
  const sectionHtml = markup(world, 'ru', 'life')
  for (const section of world.sections) {
    assert.ok(sectionHtml.includes(`data-testid="deep-section-${section.id}"`), `section row missing for ${section.id}`)
  }

  assert.ok(world.batches.length > 0, 'the world must have beds')
  const bedHtml = markup(world, 'ru', 'greenhouse')
  for (const batch of world.batches) {
    assert.ok(bedHtml.includes(`data-testid="deep-batch-${batch.id}"`), `bed row missing for ${batch.id}`)
  }
})

test('every tab renders from a real world without throwing', () => {
  const world = worldAfterOneSol()
  for (const tab of DEEP_TABS) {
    const html = markup(world, 'en', tab)
    assert.ok(html.includes('data-testid="deep-panels"'), `${tab} did not render`)
    assert.ok(!html.includes('undefined'), `${tab} markup contains "undefined"`)
  }
})

test('no row renders undefined or NaN', () => {
  const html = markup(worldAfterOneSol(), 'en')
  assert.ok(!html.includes('undefined'), 'markup contains "undefined"')
  assert.ok(!html.includes('NaN'), 'markup contains "NaN"')
})

test('arrow keys walk the tabs and wrap at both ends', () => {
  // Правило ARIA: стрелка с последней вкладки — на первую и наоборот.
  assert.equal(nextTab('crew', 'ArrowRight'), 'tasks')
  assert.equal(nextTab('crew', 'ArrowLeft'), 'journal', 'left from the first wraps to the last')
  assert.equal(nextTab('journal', 'ArrowRight'), 'crew', 'right from the last wraps to the first')
  assert.equal(nextTab('tasks', 'ArrowLeft'), 'crew')
  assert.equal(nextTab('greenhouse', 'Home'), 'crew')
  assert.equal(nextTab('crew', 'End'), 'journal')
  assert.equal(nextTab('crew', 'Enter'), null, 'unrelated keys are left alone')
  assert.equal(nextTab('crew', 'ArrowDown'), null)
})

test('a full cycle of ArrowRight visits every tab and returns', () => {
  let tab: DeepTab = 'crew'
  const seen: DeepTab[] = []
  for (let step = 0; step < DEEP_TABS.length; step++) {
    tab = nextTab(tab, 'ArrowRight')!
    seen.push(tab)
  }
  assert.equal(tab, 'crew', 'a full cycle must return to the start')
  assert.equal(new Set(seen).size, DEEP_TABS.length, 'the cycle must visit every tab exactly once')
})

test('the tabs are wired as ARIA tabs, not just a row of buttons', () => {
  const html = markup(worldAfterOneSol(), 'en', 'stores')
  assert.match(html, /role="tablist"/, 'the tab list has no role')
  assert.match(html, /role="tabpanel"/, 'the panel has no role')
  assert.match(html, /aria-labelledby="deep-tab-stores"/, 'the panel is not labelled by the open tab')

  const selected = [...html.matchAll(/aria-selected="true"/g)]
  assert.equal(selected.length, 1, `exactly one tab must be selected, found ${selected.length}`)

  // В roving tabindex фокус держит только выбранная вкладка: иначе Tab
  // заставляет перебирать все десять подряд. Сама панель тоже фокусируема —
  // по ARIA это верно, поэтому считаем именно кнопки.
  const focusable = [...html.matchAll(/<button[^>]*tabindex="0"/g)]
  assert.equal(focusable.length, 1, 'exactly one tab must be in the tab order')
  for (const tab of DEEP_TABS) {
    assert.ok(html.includes(`id="deep-tab-${tab}"`), `tab ${tab} has no id`)
  }
  const controls = [...html.matchAll(/aria-controls="deep-panel"/g)]
  assert.equal(controls.length, DEEP_TABS.length, 'every tab must point at the panel')
})

test('the life panel reports the backup runtime, not just the atmosphere', () => {
  // Игроку нужно видеть не только давление, но и сколько база продержится без
  // солнца: это число решающее — чистить панели или экономить.
  const world = worldAfterOneSol()
  for (const language of ['ru', 'en']) {
    const html = markup(world, language, 'life')
    assert.ok(html.includes('deep-power-summary'), 'the power summary must be rendered')
    assert.ok(html.includes(language === 'ru' ? 'Запас хода' : 'Backup runtime'),
      `the backup runtime must be visible in ${language}`)
    assert.ok(!/NaN|undefined/.test(html), `the summary must not render NaN in ${language}`)
  }
})

test('isolation and safe mode are reachable from the panel, not only in code', () => {
  // Оба действия имели последствия в модели и не имели ни одной кнопки:
  // игрок не мог отсечь секцию ни остановить агрегат.
  const world = worldAfterOneSol()
  for (const language of ['ru', 'en']) {
    const life = markup(world, language, 'life')
    const section = world.sections[0]
    assert.ok(life.includes(`deep-isolate-${section.id}`),
      `the isolate control must render in ${language}`)
    assert.ok(life.includes('aria-pressed'), 'the control must expose its state to assistive tech')

    const repair = markup(world, language, 'repair')
    const device = world.devices[0]
    assert.ok(repair.includes(`deep-safemode-${device.id}`),
      `the safe-mode control must render in ${language}`)
  }
})

/**
 * Карточка месторождения дополнена полями, которых требует ТЗ (содержание
 * льда, сложность, уровень разведки, склад на площадке, срок по оценке), —
 * но она не должна выдавать скрытый запас. Истинный объём (`actualKg`)
 * лежит в модели отдельно от оценки, и показывать его — значит отменять
 * всю механику разведки: оценка станет точной с первого дня.
 */
test('the deposit card shows what a surveyor could know, and hides the true reserve', () => {
  const world = worldAfterOneSol()
  for (const language of ['ru', 'en']) {
    const html = markup(world, language, 'extraction')
    for (const deposit of world.deposits) {
      assert.ok(html.includes(deposit.name), `the deposit must be listed in ${language}`)
      // Оценка видна, истина — нет.
      assert.ok(!html.includes(String(Math.round(deposit.actualKg))),
        `the true reserve must stay hidden in ${language}: ${deposit.actualKg}`)
    }
    // Поля ТЗ присутствуют в разметке.
    for (const key of ['Лёд', 'Сложность', 'Разведка', 'На площадке', 'Запас на', 'Энергия']) {
      if (language === 'ru') assert.ok(html.includes(key), `the card must show ${key}`)
    }
    // Положительный контроль: без него «истина не видна» означало бы лишь,
    // что таблица вообще не печатает чисел. Оценка — другое число, и оно
    // на экране есть.
    const estimated = world.deposits[0].estimateKg
    assert.ok(estimated > 0 && Math.abs(estimated - world.deposits[0].actualKg) > 1,
      'the fixture must have a real gap between the estimate and the truth')
    assert.ok(world.deposits[0].iceFraction > 0 && world.deposits[0].hardness > 0,
      'the fixture must carry ice content and hardness, otherwise the columns are empty')
  }
})
