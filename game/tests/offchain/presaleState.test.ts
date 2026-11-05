// SKR purchase remains disabled until a separate, explicit launch approval.
// SOL presale purchase (buy_field_sol) is the cold-start path and is gated by a
// client flag instead of being absent from the codebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PRESALE_STATE_CAP_OFFSET,
  PRESALE_STATE_PRICE_LAMPORTS_OFFSET,
  PRESALE_STATE_SOLD_OFFSET,
  decodePresaleState,
  presaleOpen,
  presalePriceLamportsFor,
  presaleRemaining,
} from '../../apps/web/src/utils/presaleState';

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('presale UI is a closed status notice with no wallet or transaction flow', () => {
  const component = source('apps/web/src/components/PresaleSection.tsx');
  assert.match(component, /data-testid="skr-presale-closed"/);
  assert.match(component, /ПОКУПКА ЗА SKR ОТКЛЮЧЕНА/);
  assert.match(component, /прежние 1053 SKR были devnet-путём покупки одного поля/);
  assert.match(component, /Повторное открытие покупки требует отдельного одобрения запуска/);
  assert.doesNotMatch(component, /useWallet|useConnection|Transaction|buy_field|transfer/);
});

test('operator-only presale builders and the SKR branch stay out of the browser client', () => {
  const client = source('apps/web/src/utils/anchorClient.ts');
  for (const builder of ['ixInitPresale', 'ixUpdatePresalePrice', 'ixBuyFieldSkr', 'ixBuyExportLicense']) {
    assert.doesNotMatch(client, new RegExp(`export\\s+(?:async\\s+)?function\\s+${builder}\\b`), `${builder} must not be exported`);
  }
});

test('SOL presale purchase exists in the client but only behind an explicit flag', () => {
  const client = source('apps/web/src/utils/anchorClient.ts');
  assert.match(client, /export async function ixBuyFieldSol\(/);
  // Флаг читается из окружения и по умолчанию закрыт: включённая кнопка при
  // закрытом тираже ведёт человека с деньгами в гарантированно падающую
  // транзакцию.
  assert.match(client, /VITE_PRESALE_SOL_ENABLED/);
  // Безопасный доступ к env: тот же модуль тайпчекается и tools-конфигом, где
  // ImportMeta объявлен без `env`.
  assert.match(client, /\(import\.meta as ImportMeta & \{ env\?:/);
  assert.match(client, /VITE_PRESALE_SOL_ENABLED === 'true'/);
  assert.match(source('apps/web/.env.example'), /VITE_PRESALE_SOL_ENABLED=false/);
});

/* ───────────────────────── раскладка PresaleState ───────────────────────── */

function presaleAccount(input: { sold: number; cap: number; priceLamports: bigint; length?: number }): Uint8Array {
  const data = new Uint8Array(input.length ?? PRESALE_STATE_PRICE_LAMPORTS_OFFSET + 8 + 1);
  const view = new DataView(data.buffer);
  data[0] = 1; // discriminator: содержимое для декодера не важно
  view.setUint32(PRESALE_STATE_SOLD_OFFSET, input.sold, true);
  view.setUint32(PRESALE_STATE_CAP_OFFSET, input.cap, true);
  if (data.length >= PRESALE_STATE_PRICE_LAMPORTS_OFFSET + 8) {
    view.setBigUint64(PRESALE_STATE_PRICE_LAMPORTS_OFFSET, input.priceLamports, true);
  }
  return data;
}

test('смещения PresaleState совпадают с раскладкой lib.rs и docs/API.md', () => {
  const libRs = source('programs/solana_potato/src/lib.rs');
  const body = libRs.match(/pub struct PresaleState\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, 'Rust PresaleState definition must exist');
  const sizes: Record<string, number> = { Pubkey: 32, u32: 4, u64: 8, u8: 1 };
  const fields = [...body.matchAll(/pub (\w+): (\w+)/g)].map(([, name, type]) => ({ name: name!, size: sizes[type!] }));
  assert.ok(fields.every(field => typeof field.size === 'number'), 'every PresaleState member needs a known size');
  let offset = 8;
  const offsets: Record<string, number> = {};
  for (const field of fields) {
    offsets[field.name] = offset;
    offset += field.size;
  }
  assert.equal(offsets.sold, PRESALE_STATE_SOLD_OFFSET);
  assert.equal(offsets.cap, PRESALE_STATE_CAP_OFFSET);
  assert.equal(offsets.price_lamports, PRESALE_STATE_PRICE_LAMPORTS_OFFSET);
});

test('декодер читает sold/cap/price и не выдумывает данные из короткого аккаунта', () => {
  assert.equal(decodePresaleState(new Uint8Array(8)), null);
  const view = decodePresaleState(presaleAccount({ sold: 7, cap: 500, priceLamports: 1_000_000n }));
  assert.deepEqual(view, { sold: 7, cap: 500, priceLamports: 1_000_000n });
  // Без поля цены (старый/усечённый аккаунт) — цена нулевая, то есть «закрыто».
  const legacy = decodePresaleState(presaleAccount({ sold: 1, cap: 10, priceLamports: 0n, length: 48 }));
  assert.deepEqual(legacy, { sold: 1, cap: 10, priceLamports: 0n });
});

test('presaleOpen учитывает и тираж, и kill switch цены', () => {
  assert.equal(presaleOpen(null), false);
  assert.equal(presaleOpen({ sold: 0, cap: 0, priceLamports: 1n }), false, 'неинициализированный тираж');
  assert.equal(presaleOpen({ sold: 5, cap: 5, priceLamports: 1n }), false, 'тираж выбран');
  assert.equal(presaleOpen({ sold: 0, cap: 5, priceLamports: 0n }), false, 'price_lamports=0 — аварийный стоп');
  assert.equal(presaleOpen({ sold: 0, cap: 5, priceLamports: 1n }), true);
  assert.equal(presaleRemaining({ sold: 3, cap: 5, priceLamports: 1n }), 2);
  assert.equal(presaleRemaining(null), 0);
});

test('цена поля за SOL масштабируется по type_cost_bps так же, как в программе', () => {
  const view = { sold: 0, cap: 500, priceLamports: 10_000_000n };
  assert.equal(presalePriceLamportsFor(view, 0), 4_000_000n); // 0.4×
  assert.equal(presalePriceLamportsFor(view, 1), 10_000_000n); // 1×
  assert.equal(presalePriceLamportsFor(view, 2), 20_000_000n); // 2×
  assert.equal(presalePriceLamportsFor(view, 9), 0n, 'неизвестный тип не должен считаться по нулевой цене');
  assert.equal(presalePriceLamportsFor({ ...view, priceLamports: 0n }, 1), 0n);
});
