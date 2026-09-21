export type Source = 'native-rpc' | 'synthetic';
export type Fields = Record<string, string | number | boolean>;
export interface Normalized {
  eventType: string; onChainEvent: string | null; category: string; resource: string | null;
  data: Fields; parserVersion: string; dataQuality: 'partial'; confidence: 'partial';
  reason?: string;
}
export interface RawFrame {
  instructionIndex: number; innerIndex: number; instructionName: string | null;
  applied: boolean; events: { logIndex: number; raw: string; decoded: Normalized }[];
}
export interface ObservedTransaction {
  slot: number; signature: string; blockTime: number | null;
  raw: unknown; frames: RawFrame[];
}
export interface SignatureInfo { signature: string; slot: number; err: unknown; blockTime: number | null }
export interface Transaction {
  slot: number; blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: Instruction[] } };
  meta: null | { err: unknown; logMessages: string[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions: null | { index: number; instructions: Instruction[] }[];
  };
}
export interface Instruction { programIdIndex: number; data: string; stackHeight?: number | null }
export interface CursorState {
  phase: 'backfill' | 'tail'; before: string | null; beforeSlot: number | null; head: string | null;
  pendingHead: string | null; scanTipSlot: number | null; reconciledSlot: number | null;
  lastSuccessAt: string | null;
}
export const initialCursor = (): CursorState => ({ phase: 'backfill', before: null, beforeSlot: null,
  head: null, pendingHead: null, scanTipSlot: null, reconciledSlot: null, lastSuccessAt: null });
export interface Checkpoint { version: number; state: CursorState }
export interface Store {
  checkpoint(): Promise<Checkpoint>;
  savePage(transactions: ObservedTransaction[], next: CursorState, expectedVersion: number): Promise<void>;
  gap(code: string): Promise<void>;
  heal(): Promise<void>;
}
