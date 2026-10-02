#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Normalize `solana program show --buffers --output json` without losing
 * lamports precision. The CLI currently emits `{"buffers":[...]}`; accepting
 * a top-level array also keeps the audit helper useful with equivalent RPC
 * snapshots. Every row must still identify the expected authority.
 */
export function parseBufferInventory(input, expectedAuthority) {
  if (typeof expectedAuthority !== 'string' || expectedAuthority.length === 0) {
    throw new Error('expected authority is required');
  }

  const document = typeof input === 'string' ? JSON.parse(input) : input;
  const rows = Array.isArray(document)
    ? document
    : document && typeof document === 'object'
      ? document.buffers ?? document.accounts
      : undefined;
  if (!Array.isArray(rows)) {
    throw new Error('inventory JSON must be an array or contain a buffers array');
  }

  const seen = new Set();
  const buffers = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`buffer row ${index} is not an object`);
    }

    const address = row.address ?? row.pubkey ?? row.publicKey;
    if (
      typeof address !== 'string' ||
      address.length === 0 ||
      address.trim() !== address ||
      address.includes(',') ||
      /\s/.test(address)
    ) {
      throw new Error(`buffer row ${index} has an invalid address`);
    }
    if (seen.has(address)) {
      throw new Error(`duplicate buffer address: ${address}`);
    }
    seen.add(address);

    if (row.authority !== expectedAuthority) {
      throw new Error(`buffer ${address} is not owned by the expected authority`);
    }

    let lamports;
    if (typeof row.lamports === 'string' && /^\d+$/.test(row.lamports)) {
      lamports = BigInt(row.lamports);
    } else if (
      typeof row.lamports === 'number' &&
      Number.isSafeInteger(row.lamports) &&
      row.lamports >= 0
    ) {
      lamports = BigInt(row.lamports);
    } else {
      throw new Error(`buffer ${address} has a missing or inexact lamports value`);
    }

    return { address, authority: row.authority, lamports: lamports.toString() };
  });

  buffers.sort((left, right) =>
    left.address < right.address ? -1 : left.address > right.address ? 1 : 0,
  );
  const sum = buffers.reduce(
    (total, buffer) => total + BigInt(buffer.lamports),
    0n,
  );
  const wholeSol = sum / 1_000_000_000n;
  const fractionalLamports = (sum % 1_000_000_000n).toString().padStart(9, '0');

  return {
    buffers,
    sumLamports: sum.toString(),
    sumSol: `${wholeSol}.${fractionalLamports}`,
    addresses: buffers.map(({ address }) => address).join(','),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const expectedAuthority = process.argv[2];
    const inventory = parseBufferInventory(
      readFileSync(0, 'utf8'),
      expectedAuthority,
    );
    process.stdout.write(`${JSON.stringify(inventory)}\n`);
  } catch (error) {
    console.error(`Invalid authority-owned buffer inventory: ${error.message}`);
    process.exitCode = 2;
  }
}
