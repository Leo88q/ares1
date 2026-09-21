import { artifact, PARSER_VERSION, RAW_PARSER_VERSION } from './artifacts.js';
import type { Fields, Normalized } from './model.js';
interface Mapping { on_chain_event: string; normalized_event: string; category: string; resource: string | null }
export const eventMap = artifact<Mapping[]>('events/ares1-event-map.json');
export function unknown(reason: string): Normalized {
  return { eventType: 'Unknown', onChainEvent: null, category: 'unknown', resource: null,
    data: {}, parserVersion: RAW_PARSER_VERSION, dataQuality: 'partial', confidence: 'partial', reason };
}
export function normalize(name: string, data: Fields, instructionName: string | null): Normalized {
  const entry = eventMap.find(x => x.on_chain_event === name);
  if (!entry) return unknown('unmapped_event');
  let resource = entry.resource;
  // The legacy and SKR presale emit the SAME event; sol_amount is not a currency tag.
  if (name === 'PresalePurchase') {
    resource = instructionName === 'buy_field_skr' ? 'SKR' : instructionName === 'buy_field_sol' ? 'SOL' : null;
  }
  return { eventType: entry.normalized_event, onChainEvent: name, category: entry.category, resource,
    data, parserVersion: PARSER_VERSION, dataQuality: 'partial', confidence: 'partial',
    ...(name === 'PresalePurchase' && resource === null ? { reason: 'unknown_payment_instruction' } : {}) };
}
