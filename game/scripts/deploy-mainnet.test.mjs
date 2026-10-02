import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployScript = join(gameRoot, 'scripts/deploy-mainnet.sh');
const SQUADS_AUTHORITY = 'SquadsVault11111111111111111111111111111111';
const DEPLOY_AUTHORITY = 'DeploySigner111111111111111111111111111111';
const BUFFER_ADDRESS = '11111111111111111111111111111111';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runScenario({
  initialState,
  args = [],
  input = '',
  releaseApproved = 'YES',
  solanaVersion = '4.2.2',
  anchorVersion = '0.31.2',
  yarnVersion = '1.22.22',
  keepBufferAuthority = false,
}) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'ares-mainnet-deploy-test-'));
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  const stateFile = join(tmp, 'program-state');
  const bufferAuthorityFile = join(tmp, 'buffer-authority');
  const logFile = join(tmp, 'commands.log');
  const keypair = join(tmp, 'deploy-signer.json');
  writeFileSync(stateFile, initialState);
  writeFileSync(bufferAuthorityFile, '');
  writeFileSync(keypair, '[1,2,3]');
  writeFileSync(logFile, '');

  const solana = `#!/usr/bin/env bash
set -euo pipefail
printf 'solana %s\\n' "$*" >> "$FAKE_LOG"
if [[ "${'${1:-}'}" == "--version" ]]; then printf 'solana-cli %s\\n' "$FAKE_SOLANA_VERSION"; exit 0; fi
case "$1:${'${2:-}'}" in
  program:show)
    if [[ "$3" == "$FAKE_BUFFER_ADDRESS" ]]; then
      authority="$(cat "$FAKE_BUFFER_AUTHORITY_FILE")"
      [[ -n "$authority" ]] || { echo "Buffer authority missing" >&2; exit 1; }
      printf '{"address":"%s","authority":"%s"}\\n' "$FAKE_BUFFER_ADDRESS" "$authority"
      exit 0
    fi
    state="$(cat "$FAKE_STATE")"
    if [[ "$state" == "MISSING" ]]; then
      echo "Error: AccountNotFound: pubkey=$3" >&2
      exit 1
    fi
    if [[ "$state" == "RPC_FAIL" ]]; then
      echo "Error: RPC connection failed for $RPC_URL" >&2
      exit 1
    fi
    printf '{"authority":"%s"}\\n' "$state"
    ;;
  account:*)
    printf '{"lamports":1}\\n'
    ;;
  program:write-buffer)
    printf '%s' "$FAKE_DEPLOY_AUTHORITY" > "$FAKE_BUFFER_AUTHORITY_FILE"
    printf 'Buffer: %s\\nSignature: FakeSignature\\n' "$FAKE_BUFFER_ADDRESS"
    ;;
  program:dump)
    cp "$FAKE_ARTIFACT_SOURCE" "$4"
    ;;
  program:set-buffer-authority)
    new_authority=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--new-buffer-authority" ]]; then
        new_authority="$2"
        shift 2
      else
        shift
      fi
    done
    [[ "$new_authority" == "$FAKE_SQUADS_AUTHORITY" ]] || exit 93
    if [[ "$FAKE_KEEP_BUFFER_AUTHORITY" != "1" ]]; then
      printf '%s' "$new_authority" > "$FAKE_BUFFER_AUTHORITY_FILE"
    fi
    printf 'set-buffer-authority %s\\n' "$new_authority" >> "$FAKE_LOG"
    ;;
  program:set-upgrade-authority)
    new_authority=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--new-upgrade-authority" ]]; then
        new_authority="$2"
        shift 2
      else
        shift
      fi
    done
    [[ "$new_authority" == "$FAKE_SQUADS_AUTHORITY" ]] || exit 91
    printf '%s' "$new_authority" > "$FAKE_STATE"
    printf 'set-upgrade-authority %s\\n' "$new_authority" >> "$FAKE_LOG"
    ;;
  *)
    echo "unexpected solana command" >&2
    exit 92
    ;;
esac
`;
  const anchor = `#!/usr/bin/env bash
set -euo pipefail
printf 'anchor %s\\n' "$*" >> "$FAKE_LOG"
if [[ "${'${1:-}'}" == "--version" ]]; then printf 'anchor-cli %s\\n' "$FAKE_ANCHOR_VERSION"; exit 0; fi
if [[ "${'${1:-}'}" == "deploy" ]]; then printf '%s' "$FAKE_DEPLOY_AUTHORITY" > "$FAKE_STATE"; fi
`;
  const yarn = `#!/usr/bin/env bash
set -euo pipefail
printf 'yarn %s\\n' "$*" >> "$FAKE_LOG"
if [[ "${'${1:-}'}" == "--version" ]]; then printf '%s\\n' "$FAKE_YARN_VERSION"; exit 0; fi
`;
  const keygen = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$FAKE_DEPLOY_AUTHORITY"
`;
  for (const [name, source] of [['solana', solana], ['anchor', anchor], ['yarn', yarn], ['solana-keygen', keygen]]) {
    const file = join(bin, name);
    writeFileSync(file, source);
    chmodSync(file, 0o755);
  }

  const artifactDir = join(gameRoot, 'target/deploy');
  const artifactPath = join(artifactDir, 'solana_potato.so');
  const hadArtifactDir = existsSync(artifactDir);
  const previousArtifact = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
  const artifact = Buffer.from(`controlled deploy test artifact:${initialState}`);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(artifactPath, artifact);

  try {
    const result = spawnSync('bash', [deployScript, ...args], {
      cwd: gameRoot,
      input,
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        DEPLOY_KEYPAIR: keypair,
        EXPECTED_SO_SHA256: sha256(artifact),
        MAINNET_AUTHORITY: SQUADS_AUTHORITY,
        MAINNET_TREASURY: 'TreasuryOwner11111111111111111111111111111',
        MAINNET_PAYER: 'BackendPayer11111111111111111111111111111',
        POTATO_MINT: 'PotatoMint1111111111111111111111111111111',
        MAINNET_RELEASE_APPROVED: releaseApproved,
        RPC_URL: 'https://mainnet.invalid/path/OUTPUT_SENTINEL',
        FAKE_STATE: stateFile,
        FAKE_BUFFER_AUTHORITY_FILE: bufferAuthorityFile,
        FAKE_KEEP_BUFFER_AUTHORITY: keepBufferAuthority ? '1' : '0',
        FAKE_LOG: logFile,
        FAKE_ARTIFACT_SOURCE: artifactPath,
        FAKE_BUFFER_ADDRESS: BUFFER_ADDRESS,
        FAKE_SQUADS_AUTHORITY: SQUADS_AUTHORITY,
        FAKE_DEPLOY_AUTHORITY: DEPLOY_AUTHORITY,
        FAKE_SOLANA_VERSION: solanaVersion,
        FAKE_ANCHOR_VERSION: anchorVersion,
        FAKE_YARN_VERSION: yarnVersion,
      },
    });
    return {
      ...result,
      commandLog: readFileSync(logFile, 'utf8'),
      finalProgramAuthority: readFileSync(stateFile, 'utf8'),
      finalBufferAuthority: readFileSync(bufferAuthorityFile, 'utf8'),
    };
  } finally {
    if (previousArtifact) writeFileSync(artifactPath, previousArtifact);
    else rmSync(artifactPath, { force: true });
    if (!hadArtifactDir) {
      try {
        rmSync(artifactDir, { recursive: false });
        rmSync(join(gameRoot, 'target'), { recursive: false });
      } catch {
        // Another build artifact may have created these directories meanwhile.
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('existing Squads-owned program cannot fall through to direct anchor deploy', () => {
  const result = runScenario({ initialState: SQUADS_AUTHORITY });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Refusing direct 'anchor deploy'/);
  assert.doesNotMatch(result.commandLog, /anchor deploy|program write-buffer/);
  assert.doesNotMatch(result.stdout + result.stderr, /OUTPUT_SENTINEL/, 'RPC credentials must not leak to output');
});

test('existing program upgrade only prepares and verifies a Squads-owned buffer', () => {
  const result = runScenario({ initialState: SQUADS_AUTHORITY, args: ['--prepare-squads-upgrade'], input: 'PREPARE\n' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`Buffer uploaded, read-back hash verified, and authority verified as Squads\\. Buffer: ${BUFFER_ADDRESS}`));
  assert.match(result.stdout, /execute the upgrade proposal through Squads/);
  assert.equal(result.finalBufferAuthority, SQUADS_AUTHORITY);
  assert.match(result.commandLog, /solana program write-buffer/);
  assert.match(result.commandLog, /solana program dump/);
  assert.match(result.commandLog, /solana program set-buffer-authority/);
  assert.doesNotMatch(result.commandLog, /anchor deploy/);
  assert.doesNotMatch(result.stdout + result.stderr, /OUTPUT_SENTINEL/);
  const source = readFileSync(deployScript, 'utf8');
  assert.match(source, /--prepare-squads-upgrade/);
  assert.match(source, /program set-buffer-authority/);
  assert.match(source, /BUFFER_SHOW=.*solana program show/);
  assert.match(source, /BUFFER_FINAL_AUTHORITY/);
  assert.doesNotMatch(source, /set-buffer-authority[\s\S]{0,200}skip-new-buffer-authority-signer-check/);
});

test('buffer upgrade preparation fails closed when the authority handoff cannot be verified', () => {
  const result = runScenario({
    initialState: SQUADS_AUTHORITY,
    args: ['--prepare-squads-upgrade'],
    input: 'PREPARE\n',
    keepBufferAuthority: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /buffer authority after transfer is not the expected Squads vault/);
  assert.equal(result.finalBufferAuthority, DEPLOY_AUTHORITY);
  assert.doesNotMatch(result.stdout, /create, approve and execute the upgrade proposal/);
});

test('first deploy requires explicit approval and transfers authority to Squads', () => {
  const result = runScenario({ initialState: 'MISSING', args: ['--allow-first-deploy'], input: 'DEPLOY\n' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /First deployment completed; on-chain upgrade authority verified/);
  assert.match(result.stdout, new RegExp(SQUADS_AUTHORITY));
  assert.equal(result.finalProgramAuthority, SQUADS_AUTHORITY);
  assert.match(result.commandLog, /anchor deploy/);
  assert.match(result.commandLog, /solana program set-upgrade-authority[\s\S]*--skip-new-upgrade-authority-signer-check/);
  assert.doesNotMatch(result.stdout + result.stderr, /OUTPUT_SENTINEL/);
  const source = readFileSync(deployScript, 'utf8');
  assert.match(source, /MAINNET_RELEASE_APPROVED/);
  assert.match(source, /--skip-new-upgrade-authority-signer-check/);
});

test('RPC failure is not mistaken for an absent program', () => {
  const result = runScenario({ initialState: 'RPC_FAIL', args: ['--allow-first-deploy'] });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /refusing to treat RPC\/CLI failure as first deploy/);
  assert.doesNotMatch(result.commandLog, /anchor deploy|program write-buffer|set-upgrade-authority/);
  assert.doesNotMatch(result.stdout + result.stderr, /OUTPUT_SENTINEL/);
});

test('mainnet release acknowledgement is required before building or querying chain', () => {
  const result = runScenario({ initialState: 'MISSING', releaseApproved: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MAINNET_RELEASE_APPROVED is required/);
  assert.doesNotMatch(result.commandLog, /anchor build|yarn check:contract|solana program show/);
  assert.doesNotMatch(result.stdout, /This is the FIRST deployment/);
});

test('unsupported Solana CLI version is rejected before build or RPC access', () => {
  const result = runScenario({ initialState: 'MISSING', solanaVersion: '4.2.1' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('use Solana CLI 4.2.2'));
  assert.doesNotMatch(result.commandLog, /anchor build|yarn check:contract|solana program show/);
});

test('unsupported Anchor version is rejected before build or RPC access', () => {
  const result = runScenario({ initialState: 'MISSING', anchorVersion: '0.30.1' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('use Anchor 0.31.2'));
  assert.doesNotMatch(result.commandLog, /anchor build|yarn check:contract|solana program show/);
});

test('unsupported Yarn version is rejected before build or RPC access', () => {
  const result = runScenario({ initialState: 'MISSING', yarnVersion: '1.22.21' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('use Yarn 1.22.22'));
  assert.doesNotMatch(result.commandLog, /anchor build|yarn check:contract|solana program show/);
});
