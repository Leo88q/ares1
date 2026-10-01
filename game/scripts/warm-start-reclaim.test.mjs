import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';

const scriptUrl = new URL('./warm-start-devnet.sh', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8');
const reclaimFunction = source.match(/^reclaim_buffers_only\(\) \{\n([\s\S]*?)^\}/m)?.[1] ?? '';
const programDetectionFunction = source.match(/^is_program_deployed\(\) \{\n([\s\S]*?)^\}/m)?.[1] ?? '';

function runProgramDetection(output, exitCode = 0) {
  const shellSource = `set -euo pipefail
ADMIN_KEYPAIR=test-keypair
RPC_URL=https://example.invalid
solana() {
  printf '%s' "$FAKE_SOLANA_OUTPUT"
  return "$FAKE_SOLANA_STATUS"
}
is_program_deployed() {
${programDetectionFunction}}
if is_program_deployed "3zNp5EuQ61pR9stq4rzYsRQnjg4AYAgW8nxRje6koQmV"; then
  printf 'true\\n'
else
  printf 'false\\n'
fi
`;
  const result = spawnSync('/bin/bash', ['-c', shellSource], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_SOLANA_OUTPUT: output,
      FAKE_SOLANA_STATUS: String(exitCode),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function snapshotTree(root) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(directory, entry.name);
      const relativePath = relative(root, fullPath);
      if (entry.isDirectory()) {
        entries.push([relativePath, '<directory>']);
        visit(fullPath);
      } else if (entry.isFile()) {
        entries.push([relativePath, readFileSync(fullPath).toString('base64')]);
      } else if (entry.isSymbolicLink()) {
        entries.push([relativePath, '<symlink>']);
      }
    }
  };
  visit(root);
  return JSON.stringify(entries);
}

test('buffer close requires exact sum, address list, TTY phrase, and fresh inventory', () => {
  assert.notEqual(reclaimFunction, '', 'reclaim-only function must exist');
  assert.match(reclaimFunction, /\[ "\$CONFIRM_RECLAIM_GENESIS" != "\$BUFFER_GENESIS_HASH" \]/);
  assert.match(reclaimFunction, /\[ "\$CONFIRM_RECLAIM_SUM" != "\$BUFFERS_SUM" \]/);
  assert.match(reclaimFunction, /\[ "\$CONFIRM_RECLAIM_ADDRESSES" != "\$BUFFERS_ADDRESSES" \]/);
  assert.match(reclaimFunction, /\[ ! -t 0 \]/);
  assert.match(reclaimFunction, /read -r -p/);
  assert.match(reclaimFunction, /INVENTORY_BEFORE_CLOSE="\$BUFFER_INVENTORY_JSON"/);
  assert.match(reclaimFunction, /\[ "\$BUFFER_INVENTORY_JSON" != "\$INVENTORY_BEFORE_CLOSE" \]/);
});

test('bulk --buffers close is not used; only individually confirmed addresses are closed', () => {
  assert.doesNotMatch(source, /solana program close --buffers/);
  assert.match(source, /solana program close "\$BUFFER_ADDRESS"/);
  assert.match(source, /--commitment confirmed/);
});

test('buffer inventory is explicitly confirmed and parser failure stops the run', () => {
  assert.match(source, /solana genesis-hash --url "\$RPC_URL"/);
  assert.match(source, /solana program show --buffers[^\n]+--commitment confirmed --output json/);
  assert.match(source, /node scripts\/buffer-inventory\.mjs "\$ADMIN"/);
  assert.match(source, /if ! fetch_buffer_inventory; then exit 1; fi/);
});

test('deployed-program detection matches the real CLI label and captures output before grep', () => {
  assert.notEqual(programDetectionFunction, '', 'is_program_deployed function must exist');
  assert.match(programDetectionFunction, /solana program show/);
  assert.match(programDetectionFunction, /ProgramData Address/);
  assert.doesNotMatch(programDetectionFunction, /\|\s*grep/);

  const realCliSample = [
    'Program Id: 3zNp5EuQ61pR9stq4rzYsRQnjg4AYAgW8nxRje6koQmV',
    'ProgramData Address: 7KhczbWwnrJYLF2YA3oyxosZLoqaPZDXh64tQJmsAAcM',
  ].join('\n');
  assert.equal(runProgramDetection(realCliSample), 'true');
});

test('deployed-program detection returns false for empty, missing-label, and failed CLI output', () => {
  const realCliSample = [
    'Program Id: 3zNp5EuQ61pR9stq4rzYsRQnjg4AYAgW8nxRje6koQmV',
    'ProgramData Address: 7KhczbWwnrJYLF2YA3oyxosZLoqaPZDXh64tQJmsAAcM',
  ].join('\n');
  assert.equal(runProgramDetection('', 0), 'false');
  assert.equal(runProgramDetection('Program Id: 3zNp5EuQ61pR9stq4rzYsRQnjg4AYAgW8nxRje6koQmV', 0), 'false');
  assert.equal(runProgramDetection('Error: account not found', 1), 'false');
  assert.equal(runProgramDetection(realCliSample, 1), 'false');
});

test('CONFIRM_RECLAIM=1 exits before build/keypair/IDL work', () => {
  const reclaimCall = source.indexOf('if [ "$CONFIRM_RECLAIM" = "1" ]; then');
  const anchorPreflight = source.indexOf('ANCHOR_VERSION=');
  const buildStep = source.indexOf('echo "==> 1/7 build');
  const keypairCreation = source.indexOf('solana-keygen new -o "$KEYPAIR_FILE"');
  const anchorKeysAndBuild = source.indexOf('\nanchor keys sync\nanchor build\n');
  const idlCopy = source.indexOf('cp target/idl/solana_potato.json apps/web/src/idl.json');
  const earlyBranch = source.slice(reclaimCall, anchorPreflight);

  assert.notEqual(reclaimCall, -1);
  assert.notEqual(anchorPreflight, -1);
  assert.notEqual(buildStep, -1);
  assert.match(earlyBranch, /reclaim_buffers_only\n  exit 0\nfi/);
  assert.doesNotMatch(earlyBranch, /anchor keys sync|anchor build|solana-keygen new|cp target\/idl/);
  assert.ok(reclaimCall < anchorPreflight);
  assert.ok(anchorPreflight < buildStep);
  assert.ok(reclaimCall < keypairCreation);
  assert.ok(reclaimCall < anchorKeysAndBuild);
  assert.ok(reclaimCall < idlCopy);
});

test('reclaim-only run leaves the working tree unchanged', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ares-reclaim-only-'));
  try {
    const worktree = join(temporaryRoot, 'game');
    const scripts = join(worktree, 'scripts');
    const fakeBin = join(temporaryRoot, 'bin');
    const home = join(temporaryRoot, 'home');
    const callLog = join(temporaryRoot, 'anchor-calls.log');
    const adminKeypair = join(temporaryRoot, 'admin-keypair.json');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(join(worktree, 'programs/solana_potato/src'), { recursive: true });
    mkdirSync(join(worktree, 'apps/web/src'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(home, { recursive: true });

    copyFileSync(scriptUrl, join(scripts, 'warm-start-devnet.sh'));
    copyFileSync(new URL('./buffer-inventory.mjs', import.meta.url), join(scripts, 'buffer-inventory.mjs'));
    writeFileSync(join(worktree, 'Anchor.toml'), 'anchor_version = "0.30.1"\n');
    writeFileSync(join(worktree, 'programs/solana_potato/src/lib.rs'), 'declare_id!("unchanged");\n');
    writeFileSync(join(worktree, 'apps/web/src/idl.json'), '{"sentinel":"unchanged"}\n');
    writeFileSync(adminKeypair, '{"test":"admin"}\n');

    const solanaStub = `#!/usr/bin/env bash
set -euo pipefail
case "${'${1:-}'}" in
  address) printf '%s\\n' 'AdminTest111111111111111111111111111111111' ;;
  genesis-hash) printf '%s\\n' 'TestGenesisHash' ;;
  program)
    if [ "${'${2:-}'}" = "show" ] && [ "${'${3:-}'}" = "--buffers" ]; then
      printf '%s\\n' '{"buffers":[]}'
    else
      printf '%s\\n' 'Program Id: AdminTest111111111111111111111111111111111'
    fi
    ;;
  *) echo "unexpected solana invocation: $*" >&2; exit 1 ;;
esac
`;
    const anchorStub = `#!/usr/bin/env bash
set -euo pipefail
printf 'anchor %s\\n' "$*" >> "$ANCHOR_CALL_LOG"
if [ "${'${1:-}'}" = "--version" ]; then printf '%s\\n' 'anchor-cli 0.30.1'; exit 0; fi
if [ "${'${1:-}'}" = "build" ]; then exit 91; fi
exit 0
`;
    const keygenStub = `#!/usr/bin/env bash
set -euo pipefail
printf 'solana-keygen %s\\n' "$*" >> "$ANCHOR_CALL_LOG"
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi
done
mkdir -p "$(dirname "$out")"
printf '%s\\n' 'test program keypair' > "$out"
`;
    const cargoStub = '#!/usr/bin/env bash\nexit 0\n';
    const writeExecutable = (name, contents) => {
      const path = join(fakeBin, name);
      writeFileSync(path, contents);
      chmodSync(path, 0o755);
    };
    writeExecutable('solana', solanaStub);
    writeExecutable('anchor', anchorStub);
    writeExecutable('solana-keygen', keygenStub);
    writeExecutable('cargo', cargoStub);

    const jqLookup = spawnSync('/bin/sh', ['-c', 'command -v jq'], { encoding: 'utf8' });
    assert.equal(jqLookup.status, 0, 'jq must be installed for the runbook tests');
    symlinkSync(process.execPath, join(fakeBin, 'node'));
    symlinkSync(jqLookup.stdout.trim(), join(fakeBin, 'jq'));

    const before = snapshotTree(worktree);
    const result = spawnSync('/bin/bash', [join(scripts, 'warm-start-devnet.sh')], {
      cwd: worktree,
      encoding: 'utf8',
      env: {
        ...process.env,
        ADMIN_KEYPAIR: adminKeypair,
        ANCHOR_CALL_LOG: callLog,
        CONFIRM_RECLAIM: '1',
        HOME: home,
        PATH: [fakeBin, '/usr/bin', '/bin'].join(delimiter),
        RPC_URL: 'https://example.invalid',
      },
    });

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /reclaim-only/);
    assert.doesNotMatch(result.stdout, /==> 1\/7 build/);
    assert.equal(snapshotTree(worktree), before, 'reclaim-only invocation must not create or rewrite worktree files');
    assert.equal(readdirSync(fakeBin).includes('anchor'), true);
    assert.equal(existsSync(callLog), false, 'Anchor/keygen must not run in reclaim-only mode');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('reclaim-only execution exits before funding, and remaining buffers block airdrop', () => {
  const reclaimComplete = source.indexOf('Этот запуск завершён после reclaim');
  const fundingStep = source.indexOf('# ── 3) Расчёт NEED_TOTAL');
  const airdropStop = source.indexOf('Airdrop остановлен: сначала вручную проверьте');
  const actualAirdrop = source.indexOf('if solana airdrop 2');

  assert.notEqual(reclaimComplete, -1);
  assert.ok(reclaimComplete < fundingStep);
  assert.notEqual(airdropStop, -1);
  assert.ok(airdropStop < actualAirdrop);
  assert.match(source.slice(airdropStop, actualAirdrop), /exit 1/);
});
