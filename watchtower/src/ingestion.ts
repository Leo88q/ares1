import { z } from 'zod';
import bs58 from 'bs58';
import { SafeError, type Config } from './config.js';
import { decodeTransaction } from './event-decoder.js';
import type { CursorState, ObservedTransaction, Store, Transaction } from './model.js';
import type { ReadRpc } from './rpc.js';
import type { Metrics } from './metrics.js';
export const signatureSchema = z.string().refine(s => {
  try { return s.length >= 64 && s.length <= 88 && bs58.decode(s).length === 64 && bs58.encode(bs58.decode(s)) === s; } catch { return false; }
});
const signaturesSchema = z.array(z.object({ signature: signatureSchema, slot: z.number().int().nonnegative().safe(),
  err: z.unknown(), blockTime: z.number().int().nullable() }));
export interface RuntimeState { finalizedTip: number | null; lastError: string | null; accountVerified: boolean }
export class Ingestion {
  readonly runtime: RuntimeState = { finalizedTip: null, lastError: null, accountVerified: false };
  constructor(private readonly config: Config, private readonly rpc: ReadRpc, private readonly store: Store,
    private readonly metrics?: Metrics) {}
  async verifyAccount() {
    const response = await this.rpc.call<{ value: null | { executable: boolean } }>('getAccountInfo',
      [this.config.programId, { encoding: 'base64', commitment: 'finalized' }]);
    if (!response.value?.executable) throw new SafeError('PROGRAM_NOT_EXECUTABLE');
    // This is not a binary/IDL equivalence or a full deployment verification.
    this.runtime.accountVerified = true;
  }
  private async transaction(signature: string, slot: number, tip: number): Promise<ObservedTransaction> {
    const tx = await this.rpc.call<Transaction | null>('getTransaction', [signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if (tx === null) throw new SafeError('TRANSACTION_GAP');
    if (tx.slot !== slot || tx.slot > tip) throw new SafeError('FINALIZED_SLOT_MISMATCH');
    return decodeTransaction(tx, signature, this.config.programId);
  }
  async step() {
    try {
      if (!this.runtime.accountVerified) await this.verifyAccount();
      const checkpoint = await this.store.checkpoint();
      const state: CursorState = { ...checkpoint.state };
      let tip = z.number().int().nonnegative().safe().parse(await this.rpc.call('getSlot', [{ commitment: 'finalized' }]));
      this.runtime.finalizedTip = tip;
      if (state.reconciledSlot !== null && tip < state.reconciledSlot) throw new SafeError('RPC_BEHIND_WATERMARK');
      if (!state.before) state.scanTipSlot = tip;
      const page = signaturesSchema.parse(await this.rpc.call('getSignaturesForAddress', [this.config.programId,
        { commitment: 'finalized', limit: this.config.pageSize, ...(state.before ? { before: state.before } : {}) }]));
      if (page.length > this.config.pageSize) throw new SafeError('INVALID_SIGNATURE_PAGE');
      // The root may advance between getSlot and the signature page response.
      if (page.some(info => info.slot > tip)) {
        tip = z.number().int().nonnegative().safe().parse(await this.rpc.call('getSlot', [{ commitment: 'finalized' }]));
        this.runtime.finalizedTip = tip;
      }
      const seen = new Set<string>();
      for (const [i, info] of page.entries()) {
        if (seen.has(info.signature) || info.signature === state.before || info.slot > tip || (state.beforeSlot !== null && info.slot > state.beforeSlot) || (i > 0 && info.slot > page[i - 1]!.slot)) {
          throw new SafeError('INVALID_SIGNATURE_PAGE');
        }
        seen.add(info.signature);
      }
      if (!state.pendingHead && page[0]) state.pendingHead = page[0].signature;
      const boundary = state.phase === 'tail' && state.head ? page.findIndex(x => x.signature === state.head) : -1;
      if (state.phase === 'tail' && state.head && !page.length) throw new SafeError('HISTORY_ANCHOR_GAP');
      const selected = boundary >= 0 ? page.slice(0, boundary + 1) : page;
      const transactions: ObservedTransaction[] = [];
      // Include the old head in every completed tail scan: re-fetch finalized data
      // and compare fingerprints atomically to detect inconsistent RPC history.
      for (const info of selected) transactions.push(await this.transaction(info.signature, info.slot, tip));
      const completed = boundary >= 0 || page.length === 0;
      if (completed) {
        state.phase = 'tail'; state.head = state.pendingHead ?? state.head;
        state.pendingHead = null; state.before = null; state.beforeSlot = null;
        state.reconciledSlot = state.scanTipSlot;
      } else { state.before = page.at(-1)!.signature; state.beforeSlot = page.at(-1)!.slot; }
      state.lastSuccessAt = new Date().toISOString();
      await this.store.savePage(transactions, state, checkpoint.version);
      await this.store.heal();
      this.runtime.lastError = null;
      this.metrics?.pages.inc();
      if (state.reconciledSlot !== null) this.metrics?.lag.set(Math.max(0, tip - state.reconciledSlot));
      return completed;
    } catch (error) {
      const code = error instanceof SafeError ? error.code : 'INGESTION_FAILED';
      this.runtime.lastError = code;
      if (code !== 'SHUTDOWN') await this.store.gap(code);
      throw new SafeError(code);
    }
  }
}
