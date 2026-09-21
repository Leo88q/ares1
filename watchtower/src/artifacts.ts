import { readFileSync } from 'node:fs';
// Paths work from src/ and dist/; no runtime dependency on the game/backend.
export function artifact<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as T;
}
export const PARSER_VERSION = 'ares1-v1';
export const RAW_PARSER_VERSION = 'ares1-raw-v1';
