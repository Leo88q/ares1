// Download only the generated public IDL for the EXACT current git revision.
// Does not silently overwrite the committed client ABI: review the output first.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const game = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'Leo88q/ares1';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: game, encoding: 'utf8' }).trim();
const api = route => JSON.parse(execFileSync('gh', ['api', route], { cwd: game, encoding: 'utf8', maxBuffer: 5_000_000 }));
const checks = api(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs;
const check = checks.find(c => c.name === 'Anchor program (build + unit + integration tests)' && c.head_sha === sha);
if (!check) throw new Error('No chain check exists for current revision');
const pages = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/check-runs/${check.id}/annotations`, '--paginate', '--slurp'], { cwd: game, encoding: 'utf8', maxBuffer: 5_000_000 }));
const annotations = pages.flat();
const one = title => {
  const matches = annotations.filter(a => a.title === title);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${title} annotation; use the build artifact instead`);
  return matches[0].message.trim();
};
const encoded = one('ares-public-idl-gzip-base64');
if (!/^[A-Za-z0-9+/=]+$/.test(encoded) || encoded.length > 48000) throw new Error('Invalid IDL transport');
const data = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 5_000_000 });
if (createHash('sha256').update(data).digest('hex') !== one('ares-public-idl-sha256')) throw new Error('IDL checksum mismatch');
const idl = JSON.parse(data);
const declared = fs.readFileSync(path.join(game, 'programs/solana_potato/src/lib.rs'), 'utf8').match(/declare_id!\("([^"]+)"\)/)?.[1];
if (idl.address !== declared || !Array.isArray(idl.instructions)) throw new Error('Generated IDL address/shape mismatch');
const output = path.join(game, 'target/idl/solana_potato.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, data);
console.log(`Saved public CI-generated IDL for ${sha} to ${output}. Review before updating apps/web/src/idl.json.`);
