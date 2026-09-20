import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('programs/solana_potato/src/lib.rs');
const idl = JSON.parse(read('apps/web/src/idl.json'));
const programId = source.match(/declare_id!\("([^"]+)"\)/)?.[1];
const errors = [];
if (!programId || idl.address !== programId) errors.push('Rust declare_id and committed IDL address differ');
const configured = [...read('Anchor.toml').matchAll(/^solana_potato\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
if (!configured.length || configured.some(id => id !== programId)) errors.push('Anchor.toml program IDs differ from declare_id');
const moduleSource = source.split('// ────────────────────────── Pure helpers')[0].split('pub mod solana_potato {')[1];
const names = [...moduleSource.matchAll(/pub fn (\w+)/g)].map(m => m[1]).sort();
const idlNames = idl.instructions.map(ix => ix.name).sort();
if (!isDeepStrictEqual(names, idlNames)) {
  errors.push(`IDL instruction inventory differs. Missing: ${names.filter(n => !idlNames.includes(n)).join(', ')}; extra: ${idlNames.filter(n => !names.includes(n)).join(', ')}`);
}
const errorBody = source.split('pub enum GameError {')[1].split('\n}')[0];
const errorNames = [...errorBody.matchAll(/^    (\w+),/gm)].map(m => m[1]);
if (!isDeepStrictEqual(errorNames.map((name, i) => ({ name, code: 6000 + i })), idl.errors.map(({ name, code }) => ({ name, code })))) {
  errors.push('IDL error names/codes differ from GameError; do not silently renumber errors');
}
if (process.argv[2]) {
  const built = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (!isDeepStrictEqual(built, idl)) errors.push('Built IDL differs from committed IDL (accounts/args/types/events/metadata included)');
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error('Regenerate with the pinned Anchor toolchain, review ABI changes, then copy target/idl/solana_potato.json to apps/web/src/idl.json.');
  process.exitCode = 1;
} else {
  console.log(`Contract checks passed (${names.length} instructions).${process.argv[2] ? '' : ' Full ABI comparison requires the built IDL argument.'}`);
}
