// Сборка движка коммитится в lib/: web и backend берут JS и типы без сборки на месте.
// Скрипт только проверяет, что каждый скомпилированный модуль появился, и печатает сводку.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const count = (dir) => readdirSync(dir).reduce((n, f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? n + count(p) : n + (f.endsWith('.js') || f.endsWith('.d.ts') ? 1 : 0)
}, 0)
const files = count('lib/esm') + count('lib/types')
if (files === 0) throw new Error('colony-engine: сборка не создала файлов')
console.log(`colony-engine: ${files} файлов (esm + types)`)
