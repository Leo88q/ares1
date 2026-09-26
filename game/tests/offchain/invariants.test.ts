import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { evaluateInvariants } from '../../scripts/check-invariants'

// Checklist items 49 / 53: the monitor's rules are pure functions, so the
// accounting invariants are tested without a cluster.

const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PublicKey.unique())[0]
const attacker = PublicKey.unique()

type InvariantInput = Parameters<typeof evaluateInvariants>[0]

const healthy = (): InvariantInput => ({
  configPda,
  mintAuthority: configPda,
  freezeAuthority: null,
  decimals: 6,
  supply: 1_000_000_000n,
  maxSupplyMicro: 1_000_000_000_000_000n,
  epochMintedMicro: 500_000_000n,
  epochCapMicro: 250_000_000_000n,
  treasuryBalanceMicro: 10_000_000n,
  questPoolBalanceMicro: 550_000_000n,
  skrDecimals: 6,
})

const failed = (input: InvariantInput) =>
  evaluateInvariants(input)
    .filter(c => !c.ok)
    .map(c => c.name)

test('healthy state violates nothing', () => {
  assert.deepEqual(failed(healthy()), [])
})

test('mint authority taken back by an EOA is a violation', () => {
  assert.deepEqual(failed({ ...healthy(), mintAuthority: attacker }), ['mint_authority_is_config_pda'])
  assert.deepEqual(failed({ ...healthy(), mintAuthority: null }), ['mint_authority_is_config_pda'])
})

test('freeze authority, decimals drift and SKR decimals drift are violations', () => {
  assert.deepEqual(failed({ ...healthy(), freezeAuthority: attacker }), ['mint_has_no_freeze_authority'])
  assert.deepEqual(failed({ ...healthy(), decimals: 9 }), ['potato_decimals_are_six'])
  assert.deepEqual(failed({ ...healthy(), skrDecimals: 9 }), ['skr_decimals_are_six'])
})

test('emission bounds are enforced on both rails', () => {
  assert.deepEqual(failed({ ...healthy(), supply: 1_000_000_000_000_001n }), ['supply_within_max_supply'])
  assert.deepEqual(failed({ ...healthy(), epochMintedMicro: 250_000_000_001n }), ['epoch_minted_within_cap'])
  // граница включена: ровно по капу — не нарушение
  assert.deepEqual(failed({ ...healthy(), epochMintedMicro: 250_000_000_000n }), [])
})

test('treasuries can never exceed the circulating supply', () => {
  assert.deepEqual(
    failed({ ...healthy(), supply: 100n, treasuryBalanceMicro: 60n, questPoolBalanceMicro: 41n }),
    ['treasuries_within_supply'],
  )
})
