/**
 * Хранилище владения слотами и выдач (S7). Работает внутри транзакции game_ops
 * (withTransaction с актором), поэтому каждая запись попадает в аудит БД.
 */
import type { Client, Pool } from '../gameops/pool.js';
import { withTransaction } from '../gameops/pool.js';

export interface StoredGrant {
  id: number;
  field_id: string;
  slot: number;
  wallet: string;
  payment_signature: string | null;
}

export interface NewGrant {
  field_id: string;
  slot: number;
  wallet: string;
  payment_signature: string | null;
  amount_units: bigint;
}

export interface NewIssuance {
  grant_id: number;
  nonce: string;
  key_id: string;
  record_hash: string;
  issued_at: Date;
  expires_at: Date;
}

/** Операции одной транзакции. Исключения уникальности поднимаются как GameOpsError (SLOT_TAKEN, PAYMENT_ALREADY_USED). */
export interface SlotStore {
  findGrantBySlot(fieldId: string, slot: number): Promise<StoredGrant | null>;
  findGrantByPayment(signature: string): Promise<StoredGrant | null>;
  insertGrant(grant: NewGrant): Promise<StoredGrant>;
  insertIssuance(issuance: NewIssuance): Promise<void>;
}

export function pgSlotStore(client: Client): SlotStore {
  return {
    async findGrantBySlot(fieldId, slot) {
      const r = await client.query<StoredGrant>(
        'SELECT id, field_id, slot, wallet, payment_signature FROM game_ops.slot_grants WHERE field_id = $1 AND slot = $2',
        [fieldId, slot],
      );
      return r.rows[0] ?? null;
    },
    async findGrantByPayment(signature) {
      const r = await client.query<StoredGrant>(
        'SELECT id, field_id, slot, wallet, payment_signature FROM game_ops.slot_grants WHERE payment_signature = $1',
        [signature],
      );
      return r.rows[0] ?? null;
    },
    async insertGrant(g) {
      const r = await client.query<StoredGrant>(
        `INSERT INTO game_ops.slot_grants (field_id, slot, wallet, payment_signature, amount_units)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, field_id, slot, wallet, payment_signature`,
        [g.field_id, g.slot, g.wallet, g.payment_signature, g.amount_units.toString()],
      );
      return r.rows[0];
    },
    async insertIssuance(i) {
      await client.query(
        `INSERT INTO game_ops.slot_record_issuances (grant_id, nonce, key_id, record_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [i.grant_id, i.nonce, i.key_id, i.record_hash, i.issued_at, i.expires_at],
      );
    },
  };
}

/** Запуск функции в одной транзакции game_ops с актором для аудита. */
export function slotTransaction(pool: Pool, actor: string) {
  return <T>(fn: (store: SlotStore) => Promise<T>): Promise<T> =>
    withTransaction(pool, actor, client => fn(pgSlotStore(client)));
}
