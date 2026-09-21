import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BN, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, type TransactionInstruction } from '@solana/web3.js';
import * as client from '../../apps/web/src/utils/anchorClient';

// This is the genuine pinned-Anchor output, not a hand-written test ABI.
// CI independently requires exact equality with a fresh build of the Rust source.
const idl = JSON.parse(fs.readFileSync('apps/web/src/idl.json', 'utf8')) as Idl;
const coder = new BorshInstructionCoder(idl);
const program = new PublicKey(idl.address);
const names = ['config', 'epoch', 'field', 'owner', 'potatoMint', 'userPotato', 'treasuryPotato',
  'seller', 'sellerProfile', 'order', 'marketStats', 'sellerPotato', 'escrow', 'buyer', 'buyerPotato',
  'presaleState', 'authority', 'buyerPresale', 'treasurySol', 'skrMint', 'buyerSkrAta', 'treasurySkrAta',
  'buybackSkrAta', 'license', 'payer', 'userSkrAta', 'referral', 'referrer', 'newSkrMint', 'newSigner',
  'achievements', 'user', 'questTreasury', 'questAta', 'userAta', 'adminState'] as const;
const keys = Object.fromEntries(names.map(name => [name, PublicKey.unique()])) as { [K in typeof names[number]]: PublicKey };
const high = 0x8123456789abcdefn;
const bn = new BN(high.toString());
const p = { ...keys, fieldId: high, fieldType: 2, orderId: high, amountMicro: high, priceLamports: high,
  maxTotalLamports: high, cap: 0x12345678, fieldPks: [] as PublicKey[] };
const cases: [string, () => Promise<TransactionInstruction>, Record<string, unknown>][] = [
  ['create_field', () => client.ixCreateField(program, p), { field_id: bn, field_type: 2 }],
  ['harvest', () => client.ixHarvest(program, p), {}],
  ['repair_field', () => client.ixRepairField(program, p), {}],
  ['upgrade_field', () => client.ixUpgradeField(program, p), {}],
  ['pay_tax', () => client.ixPayTax(program, p), {}],
  ['apply_fertilizer', () => client.ixApplyFertilizer(program, p), {}],
  ['create_sell_order', () => client.ixCreateSellOrder(program, p), { order_id: bn, amount_micro: bn, price_lamports_per_potato: bn }],
  ['fill_order', () => client.ixFillOrder(program, p), {}],
  ['cancel_order', () => client.ixCancelOrder(program, p), {}],
  ['init_presale', () => client.ixInitPresale(program, p), { cap: p.cap, price_lamports: bn }],
  ['update_presale_price', () => client.ixUpdatePresalePrice(program, p), { price_lamports: bn }],
  ['buy_field_sol', () => client.ixBuyFieldSol(program, p), { field_id: bn, field_type: 2, max_total_lamports: bn }],
  ['buy_field_skr', () => client.ixBuyFieldSkr(program, p), { field_id: bn }],
  ['buy_export_license', () => client.ixBuyExportLicense(program, p), {}],
  ['migrate_config', () => client.ixMigrateConfig(program, p), {}],
  ['migrate_field', () => client.ixMigrateField(program, p), {}],
  ['migrate_epoch', () => client.ixMigrateEpoch(program, p), {}],
  ['register_referrer', () => client.ixRegisterReferrer(program, p, keys.referrer), { referrer: keys.referrer }],
  ['batch_harvest', () => client.ixBatchHarvest(program, p), {}],
  ['close_field', () => client.ixCloseField(program, p), {}],
  ['update_skr_mint', () => client.ixUpdateSkrMint(program, p), { new_skr_mint: keys.newSkrMint }],
  ['apply_pending_skr_mint', () => client.ixApplyPendingSkrMint(program, p), {}],
  ['apply_pending_presale_price', () => client.ixApplyPendingPresalePrice(program, p), {}],
  ['close_old_epoch', () => client.ixCloseOldEpoch(program, p), {}],
  ['update_reward_signer', () => client.ixUpdateRewardSigner(program, p), { new_signer: keys.newSigner }],
  ['claim_achievement', () => client.ixClaimAchievement(program, p, 3, []), { quest_id: 3 }],
];
for (const [name, build, args] of cases) {
  test(`browser ABI: ${name} matches generated discriminator, args, account order and privileges`, async () => {
    const spec = idl.instructions.find(ix => ix.name === name)!;
    assert(spec, `Missing instruction ${name}`);
    const actual = await build();
    assert(actual.programId.equals(program));
    assert.deepEqual(actual.data, coder.encode(name, args));
    assert.equal(actual.keys.length, spec.accounts.length);
    for (const [i, account] of spec.accounts.entries()) {
      assert('name' in account && !('accounts' in account), 'Flatten nested accounts explicitly');
      const a = account as { name: string; address?: string; writable?: boolean; signer?: boolean };
      const param = a.name === 'user_potato_ata' ? 'userAta' : a.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      // slot_hashes is an address-checked UncheckedAccount on-chain (Sysvar<SlotHashes> is
      // UnsupportedSysvar, so it cannot be a typed Sysvar). Anchor does not emit its `address`
      // into the IDL for UncheckedAccount, but the browser builder pins it to the sysvar, so
      // the ABI test pins it here too instead of relying on a generated account key.
      const expected = a.address ? new PublicKey(a.address)
        : a.name === 'slot_hashes' ? SYSVAR_SLOT_HASHES_PUBKEY
        : keys[param as keyof typeof keys];
      assert(expected, `Unmapped account ${name}.${a.name}`);
      assert.deepEqual(actual.keys[i], { pubkey: expected, isWritable: !!a.writable, isSigner: !!a.signer }, `${name}.${a.name}`);
    }
  });
}

test('market optional accounts retain fixed positions for every license/referral combination', async () => {
  const fixed = idl.instructions.find(ix => ix.name === 'fill_order')!.accounts.length;
  const license = PublicKey.unique(), referral = PublicKey.unique(), referrerAta = PublicKey.unique();
  for (let mask = 0; mask < 8; mask++) {
    const supplied = [mask & 1 ? license : null, mask & 2 ? referral : null, mask & 4 ? referrerAta : null];
    const ix = await client.ixFillOrder(program, { ...p, sellerLicense: supplied[0], buyerReferral: supplied[1], referrerPotato: supplied[2] });
    const last = supplied[2] ? 2 : supplied[1] ? 1 : supplied[0] ? 0 : -1;
    assert.equal(ix.keys.length, fixed + last + 1);
    for (let slot = 0; slot <= last; slot++) {
      assert.deepEqual(ix.keys[fixed + slot], { pubkey: supplied[slot] ?? SystemProgram.programId, isSigner: false, isWritable: slot === 2 });
    }
  }
});

test('batch harvest and achievement append only correctly privileged field accounts', async () => {
  const fields = [PublicKey.unique(), PublicKey.unique()];
  const batch = await client.ixBatchHarvest(program, { ...p, fieldPks: fields });
  const claim = await client.ixClaimAchievement(program, p, 0, fields);
  assert.deepEqual(batch.keys.slice(-2), fields.map(pubkey => ({ pubkey, isSigner: false, isWritable: true })));
  assert.deepEqual(claim.keys.slice(-2), fields.map(pubkey => ({ pubkey, isSigner: false, isWritable: false })));
});
