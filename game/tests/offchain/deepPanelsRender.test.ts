import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactNS from 'react'

// `apps/web` собирается с автоматическим JSX-рантаймом (`jsx: react-jsx`), а
// этот прогон идёт через корневой tsconfig, где JSX классический. Компонент
// править из-за теста не надо — достаточно дать ему `React` в области видимости.
;(globalThis as unknown as { React: unknown }).React = ReactNS

import { DeepPanels, DEEP_TABS, type DeepTab } from '../../apps/web/src/colony/DeepPanels'
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
