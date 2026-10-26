import { Connection, PublicKey, type Commitment } from '@solana/web3.js';
import { decodeField } from '../anchorRaw.js';

const OWNERSHIP_COMMITMENT: Commitment = 'finalized';

export interface FieldOwnershipEvidence {
  wallet: string;
  fieldAddress: string;
  cluster: 'devnet' | 'mainnet-beta';
  commitment: 'finalized';
  observedSlot: number;
  fieldLevel: number;
  fieldType: number;
  durability: number;
}

export class FieldOwnershipError extends Error {
  constructor(readonly code: 'INVALID_ADDRESS' | 'NOT_FOUND' | 'WRONG_PROGRAM' | 'NOT_OWNER' | 'INACTIVE' | 'RPC_DISAGREEMENT' | 'SECONDARY_REQUIRED') {
    super(code);
    this.name = 'FieldOwnershipError';
  }
}

/**
 * Verify a Field from the finalized program-owned account, not client claims.
 * If a secondary provider is configured, require byte-identical account data.
 */
export async function verifyFieldOwnership(params: {
  primary: Connection;
  secondary?: Connection;
  requireSecondary?: boolean;
  cluster: 'devnet' | 'mainnet-beta';
  programId: PublicKey;
  wallet: string;
  fieldAddress: string;
}): Promise<FieldOwnershipEvidence> {
  let wallet: PublicKey;
  let fieldAddress: PublicKey;
  try {
    wallet = new PublicKey(params.wallet);
    fieldAddress = new PublicKey(params.fieldAddress);
  } catch {
    throw new FieldOwnershipError('INVALID_ADDRESS');
  }
  if (wallet.toBase58() !== params.wallet || fieldAddress.toBase58() !== params.fieldAddress) {
    throw new FieldOwnershipError('INVALID_ADDRESS');
  }
  if (params.requireSecondary && !params.secondary) throw new FieldOwnershipError('SECONDARY_REQUIRED');

  const primary = await params.primary.getAccountInfoAndContext(fieldAddress, OWNERSHIP_COMMITMENT);
  if (!primary.value) throw new FieldOwnershipError('NOT_FOUND');
  if (!primary.value.owner.equals(params.programId)) throw new FieldOwnershipError('WRONG_PROGRAM');
  let field;
  try {
    field = decodeField(Buffer.from(primary.value.data));
  } catch {
    throw new FieldOwnershipError('WRONG_PROGRAM');
  }
  if (!field.owner.equals(wallet)) throw new FieldOwnershipError('NOT_OWNER');
  if (!field.isActive || field.durability === 0) throw new FieldOwnershipError('INACTIVE');

  if (params.secondary) {
    const secondary = await params.secondary.getAccountInfoAndContext(fieldAddress, OWNERSHIP_COMMITMENT);
    if (!secondary.value || !secondary.value.owner.equals(params.programId)
      || !Buffer.from(secondary.value.data).equals(Buffer.from(primary.value.data))) {
      throw new FieldOwnershipError('RPC_DISAGREEMENT');
    }
  }

  return {
    wallet: wallet.toBase58(),
    fieldAddress: fieldAddress.toBase58(),
    cluster: params.cluster,
    commitment: 'finalized',
    observedSlot: primary.context.slot,
    fieldLevel: field.level,
    fieldType: field.fieldType,
    durability: field.durability,
  };
}
