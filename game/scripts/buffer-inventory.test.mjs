import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBufferInventory } from './buffer-inventory.mjs';

const authority = 'HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9';

test('normalizes the Solana CLI shape, sorts addresses, and sums exact lamports', () => {
  const parsed = parseBufferInventory(
    {
      buffers: [
        { address: 'Z-buffer', authority, dataLen: 10, lamports: 3_441_054_840 },
        { address: 'A-buffer', authority, dataLen: 20, lamports: '3235091320' },
      ],
      useLamportsUnit: true,
    },
    authority,
  );

  assert.deepEqual(parsed, {
    buffers: [
      { address: 'A-buffer', authority, lamports: '3235091320' },
      { address: 'Z-buffer', authority, lamports: '3441054840' },
    ],
    sumLamports: '6676146160',
    sumSol: '6.676146160',
    addresses: 'A-buffer,Z-buffer',
  });
});

test('preserves totals beyond Number.MAX_SAFE_INTEGER using decimal strings', () => {
  const parsed = parseBufferInventory(
    {
      buffers: [
        { address: 'A-buffer', authority, lamports: '9007199254740993' },
        { address: 'B-buffer', authority, lamports: '1' },
      ],
    },
    authority,
  );
  assert.equal(parsed.sumLamports, '9007199254740994');
  assert.equal(parsed.sumSol, '9007199.254740994');
});

test('accepts an empty confirmed inventory', () => {
  assert.deepEqual(parseBufferInventory({ buffers: [] }, authority), {
    buffers: [],
    sumLamports: '0',
    sumSol: '0.000000000',
    addresses: '',
  });
});

test('fails closed for a row with a different authority', () => {
  assert.throws(
    () =>
      parseBufferInventory(
        { buffers: [{ address: 'A-buffer', authority: 'other', lamports: 1 }] },
        authority,
      ),
    /not owned by the expected authority/,
  );
});

test('fails closed for duplicate or malformed addresses', () => {
  assert.throws(
    () =>
      parseBufferInventory(
        {
          buffers: [
            { address: 'A-buffer', authority, lamports: 1 },
            { address: 'A-buffer', authority, lamports: 2 },
          ],
        },
        authority,
      ),
    /duplicate buffer address/,
  );
  assert.throws(
    () =>
      parseBufferInventory(
        { buffers: [{ address: 'A-buffer,other', authority, lamports: 1 }] },
        authority,
      ),
    /invalid address/,
  );
});

test('fails closed when lamports are missing, fractional, negative, or inexact', () => {
  for (const lamports of [undefined, 1.5, -1, 9_007_199_254_740_992]) {
    assert.throws(
      () =>
        parseBufferInventory(
          { buffers: [{ address: 'A-buffer', authority, lamports }] },
          authority,
        ),
      /inexact lamports value/,
    );
  }
});

test('rejects unknown inventory shapes and missing authority', () => {
  assert.throws(() => parseBufferInventory({ items: [] }, authority), /must be an array/);
  assert.throws(() => parseBufferInventory({ buffers: [] }, ''), /authority is required/);
});
