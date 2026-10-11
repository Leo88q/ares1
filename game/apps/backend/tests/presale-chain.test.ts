import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { fetchPaymentView, fetchTreasuryTransfers } from '../src/presale/chain.js';

const payer = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;

test('treasury reconciliation paginates finalized history and stops below minSlot', async () => {
  const pageOne = Array.from({ length: 1_000 }, (_, index) => ({
    signature: `old-${index}`,
    slot: 2_000 - index,
    err: { historic: true },
  }));
  const pageTwo = [
    { signature: 'payment-2', slot: 2, err: null },
    { signature: 'payment-1', slot: 1, err: null },
    { signature: 'too-old', slot: 0, err: null },
  ];
  const calls: Array<{ options: Record<string, unknown>; commitment: string | undefined }> = [];
  const txSlots = new Map([['payment-2', 2], ['payment-1', 1]]);
  const connection = {
    async getSignaturesForAddress(_address: PublicKey, options: Record<string, unknown>, commitment?: string) {
      calls.push({ options, commitment });
      return calls.length === 1 ? pageOne : pageTwo;
    },
    async getTransaction(signature: string) {
      const slot = txSlots.get(signature);
      if (slot === undefined) return null;
      return {
        slot,
        blockTime: 1_800_000_000,
        transaction: { message: { accountKeys: [payer, treasury] } },
        meta: { err: null, preBalances: [1_000, 0], postBalances: [990, 10] },
      };
    },
    async getSignatureStatuses() {
      return { value: [{ confirmationStatus: 'finalized' }] };
    },
  } as unknown as Connection;

  const transfers = await fetchTreasuryTransfers(connection, treasury.toBase58(), 1n);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.commitment, 'finalized');
  assert.equal(calls[1]?.options.before, 'old-999');
  assert.deepEqual(transfers.map(transfer => [transfer.signature, transfer.slot, transfer.units]), [
    ['payment-2', 2n, 10n],
    ['payment-1', 1n, 10n],
  ]);
});

test('versioned transaction account keys include loaded addresses in balance-index order', async () => {
  const connection = {
    async getTransaction() {
      return {
        slot: 42,
        blockTime: null,
        transaction: {
          message: {
            staticAccountKeys: [payer],
            getAccountKeys({ accountKeysFromLookups }: { accountKeysFromLookups?: { writable: PublicKey[]; readonly: PublicKey[] } } = {}) {
              const writable = accountKeysFromLookups?.writable ?? [];
              const readonly = accountKeysFromLookups?.readonly ?? [];
              return {
                staticAccountKeys: [payer],
                accountKeysFromLookups: { writable, readonly },
                keySegments: () => [[payer], writable, readonly],
              };
            },
          },
        },
        meta: {
          err: null,
          preBalances: [1_000, 0],
          postBalances: [990, 10],
          loadedAddresses: { writable: [treasury], readonly: [] },
        },
      };
    },
    async getSignatureStatuses(_signatures: string[], config: { searchTransactionHistory?: boolean }) {
      assert.equal(config.searchTransactionHistory, true);
      return { value: [{ confirmationStatus: 'finalized' }] };
    },
  } as unknown as Connection;

  const view = await fetchPaymentView(connection, 'versioned-signature');
  assert.deepEqual(view?.accountKeys, [payer.toBase58(), treasury.toBase58()]);
  assert.deepEqual(view?.postBalances, [990n, 10n]);
});
