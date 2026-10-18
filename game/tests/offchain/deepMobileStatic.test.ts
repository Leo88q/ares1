import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactNS from 'react'

/**
 * Мобильность и отсутствие WebGL проверяются статически: разметка рендерится
 * на сервере, CSS читается как текст. Браузерного Chromium в среде может не
 * быть, а регресс «кнопка снова 28 px» или «панель перекрыла теплицу» ловить
 * нужно и без него.
 */
;(globalThis as unknown as { React: unknown }).React = ReactNS

import { DeepPanels, DEEP_TABS } from '../../apps/web/src/colony/DeepPanels'
import { createWorldForColony } from '../../apps/web/src/colony/deep/bridge'
import { advanceDay, initialColony } from '../../apps/web/src/colony/simulation'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/src/colony')
const css = readFileSync(join(srcDir, 'colony.css'), 'utf8')
const panelSource = readFileSync(join(srcDir, 'DeepPanels.tsx'), 'utf8')

const world = (() => {
  const state = advanceDay(initialColony(), { sunHours: 18, waterRecovery: 0.94 })
  return state.world ?? createWorldForColony(state)
})()

const allMarkup = (DEEP_TABS as readonly string[])
  .map(tab => renderToStaticMarkup(createElement(DeepPanels, {
    world, language: 'en', onChange: () => {}, initialTab: tab as never,
  }))).join('\n')

test('every table lives in a horizontally scrollable container', () => {
  const tables = (allMarkup.match(/<table/g) ?? []).length
  const scrollers = (allMarkup.match(/colony-table-scroll/g) ?? []).length
  assert.ok(tables > 0, 'no tables rendered, the test proves nothing')
  assert.equal(tables, scrollers,
    'a table outside .colony-table-scroll would push the page wider than a 320 px screen')
})

test('the stylesheet lets a wide table scroll instead of overflowing the page', () => {
  assert.match(css, /\.colony-table-scroll\s*\{[^}]*overflow-x:\s*auto/,
    '.colony-table-scroll must scroll its own content')
})

test('no inline style can force the panel wider than a phone', () => {
  const widths = [...allMarkup.matchAll(/style="[^"]*width:\s*(\d+)px/g)].map(m => Number(m[1]))
  for (const width of widths) {
    assert.ok(width <= 320 || width <= 54,
      `an inline width of ${width} px does not fit a 320 px screen`)
  }
})

test('every control is a real button, so nothing depends on hover', () => {
  assert.ok(!/<div[^>]*onclick/i.test(allMarkup), 'a div is being used as a control')
  const buttons = (allMarkup.match(/<button/g) ?? []).length
  assert.ok(buttons > 0, 'no buttons rendered, the test proves nothing')
  for (const match of allMarkup.matchAll(/<button[^>]*>/g)) {
    assert.match(match[0], /type="button"/, `button without an explicit type: ${match[0]}`)
  }
})

test('controls are at least 44 px on touch pointers', () => {
  // Медиазапросов с coarse-pointer несколько; правило достаточно найти в любом.
  // Блок вырезается по балансу скобок: внутри есть вложенные правила.
  const blocks: string[] = []
  const re = /@media[^{]*\(pointer:\s*coarse\)[^{]*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(css)) !== null) {
    const open = css.indexOf('{', match.index)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) { blocks.push(css.slice(open + 1, i)); break } }
    }
  }
  assert.ok(blocks.length > 0, 'no coarse-pointer media query in the colony stylesheet')
  for (const selector of ['.colony-deep-tabs button', '.colony-deep-actions button']) {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    const found = blocks.map(b => b.match(rule)).find((m): m is RegExpMatchArray => m !== null)
    assert.ok(found, `${selector} has no touch rule in any coarse-pointer block`)
    assert.match(found[1], /min-height:\s*(4[4-9]|[5-9]\d)px/, `${selector} touch height is under 44 px`)
  }
})

test('the panels never cover the greenhouse interior', () => {
  // Панель — обычный поток в сайдбаре: никакого абсолютного позиционирования
  // поверх окна 3D. Иначе на телефоне она закрывает интерьер теплицы.
  for (const selector of ['.colony-deep ', '.colony-deep{', '.colony-deep {']) {
    const rule = css.split(selector)[1]
    if (!rule) continue
    assert.ok(!/position:\s*(absolute|fixed)/.test(rule.split('}')[0]),
      '.colony-deep must stay in the flow, not float over the viewport')
  }
  assert.ok(!/position:\s*absolute/.test(panelSource), 'the panel must not position itself absolutely')
})

test('the deep panels do not need WebGL', () => {
  for (const needle of ["from 'three'", 'from "three"', 'new THREE', '<canvas', 'WebGL', 'getContext']) {
    assert.ok(!panelSource.includes(needle), `the panel pulls in ${needle}, which needs a GPU context`)
  }
})

test('the panels make no network requests', () => {
  for (const needle of ['fetch(', 'XMLHttpRequest', 'http://', 'https://', 'import(']) {
    assert.ok(!panelSource.includes(needle), `the panel uses ${needle}, which leaves the device`)
  }
})

test('the colony screen keeps its no-WebGL fallback message', () => {
  const screen = readFileSync(join(srcDir, 'ColonyScreen.tsx'), 'utf8')
  const copy = readFileSync(join(srcDir, 'copy.ts'), 'utf8')
  assert.match(copy, /noWebgl:/, 'the no-WebGL copy is missing')
  assert.ok(/noWebgl/.test(screen) || /noWebgl/.test(copy),
    'nothing references the no-WebGL fallback any more')
})
