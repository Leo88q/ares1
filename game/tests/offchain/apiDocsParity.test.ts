import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Документ и роутер не должны разъезжаться молча.
 *
 * `docs/API.md` — единственное место, где описан контракт денежных
 * маршрутов (`/api/presale/*`): статусы, машинные коды, порядок шагов
 * «решение → выплата». Раньше там был только раздел наград, и админские
 * маршруты существовали без описания; обратная ошибка не менее дорогая —
 * документ, обещающий маршрут, которого нет.
 *
 * Проверка двусторонняя и узкая: пресейл (деньги) в обе стороны, остальные
 * префиксы — только «документ не выдумывает маршрут». Список маршрутов
 * `game_ops` в документе намеренно суммарный, поэтому обратная проверка для
 * него не применяется.
 */

const DOC = 'docs/API.md'
const doc = readFileSync(DOC, 'utf8')

/** Маршруты, объявленные в роутере: `router.get('/packs', …)`. */
function routerRoutes(file: string, prefix: string): Set<string> {
  const src = readFileSync(file, 'utf8')
  const routes = new Set<string>()
  for (const match of src.matchAll(/router\.(get|post)\(\s*['"]([^'"]+)['"]/g)) {
    const method = match[1]!.toUpperCase()
    const path = match[2]!.replace(/\/$/, '')
    routes.add(`${method} ${prefix}${path === '/' ? '' : path}`)
  }
  return routes
}

/** Маршруты, обещанные документом в таблицах: `| \`GET /api/...\` |`. */
function documentedRoutes(): string[] {
  const routes: string[] = []
  for (const match of doc.matchAll(/\|\s*`(GET|POST)\s+(\/[^`\s]+)`/g)) {
    routes.push(`${match[1]!} ${match[2]!.replace(/\/$/, '')}`)
  }
  return [...new Set(routes)]
}

const PRESALE = routerRoutes('apps/backend/src/routes/presale.ts', '/api/presale')

test('каждый маршрут пресейла описан в docs/API.md', () => {
  const documented = new Set(documentedRoutes())
  const missing = [...PRESALE].filter(route => !documented.has(route)).sort()
  assert.deepEqual(
    missing,
    [],
    `Маршруты без описания в docs/API.md (деньги не должны быть «как-нибудь»):\n${missing.join('\n')}`,
  )
})

test('документ не обещает несуществующих маршрутов', () => {
  const known = new Map<string, Set<string>>([
    ['/api/presale', PRESALE],
    ['/api/rewards', routerRoutes('apps/backend/src/rewards/router.ts', '/api/rewards')],
    ['/api/store', routerRoutes('apps/backend/src/routes/store.ts', '/api/store')],
    ['/api/features', routerRoutes('apps/backend/src/routes/features.ts', '/api/features')],
  ])
  // `/api/gameops`, `/api/slots`, `/api/colonies` описаны в документе суммарно
  // (перечень групп, а не таблица маршрутов), поэтому здесь не сверяются.
  const phantom: string[] = []
  for (const route of documentedRoutes()) {
    const path = route.split(' ')[1]!
    const prefix = [...known.keys()].find(candidate => path === candidate || path.startsWith(`${candidate}/`))
    if (!prefix) continue
    if (!known.get(prefix)!.has(route)) phantom.push(route)
  }
  assert.deepEqual(phantom, [], `docs/API.md описывает маршруты, которых нет в коде:\n${phantom.join('\n')}`)
})
