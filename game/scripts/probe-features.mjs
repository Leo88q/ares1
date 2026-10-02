#!/usr/bin/env node
/**
 * probe-features — проверка состояния SIMD-фич кластера (только чтение, R2).
 *
 * Зачем: модель §5 (reports/rent-audit/) опирается на три фичи, и её вердикт
 * зависел от фактического состояния кластера:
 *   SIMD-0431  loader_v3_minimum_extend_program_size  — минимальный extend 10 КиБ;
 *   SIMD-0433  loader_v3_set_program_data_to_elf_length — ProgramData = длина ELF;
 *   SIMD-0500  disable_sbpf_v0_v1_v2_deployment      — запрет SBPF v0-v2 при деплое.
 *
 * Ответ — одной аннотацией `ares-features` (логи job в API-only окружении
 * недоступны): по каждой фиче «активна (slot N)» / «отложена» / «нет в кластере».
 * Mainnet запрещён (R1) — скрипт отказывается с ним работать.
 *
 * Запуск:
 *   node scripts/probe-features.mjs --rpc https://api.devnet.solana.com
 */
import path from 'node:path';
import { rpcCall } from './deploy-budget.mjs';

/** Описания фич; id — из agave `feature-set/src/lib.rs` (v4.2.2/v4.3.0/master). */
export const FEATURES = Object.freeze([
  {
    simd: 'SIMD-0431',
    name: 'loader_v3_minimum_extend_program_size',
    id: 'YbbRLkvenrocjGPGyoQE4wjnvYzTgfsk38NFmcYK7a5',
    source: 'feature-set v4.2.2:1494',
  },
  {
    simd: 'SIMD-0433',
    name: 'loader_v3_set_program_data_to_elf_length',
    id: 'EhisBfVtGvEA8bVCVN5VMaYEaX6iTfoUrmcDi8LY7Kxy',
    source: 'feature-set master:1540 (в v4.2.2/v4.3.0 модуля нет)',
  },
  {
    simd: 'SIMD-0500',
    name: 'disable_sbpf_v0_v1_v2_deployment',
    id: 'B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g',
    source: 'feature-set v4.2.2:1235',
  },
  {
    // Нужна для решения по варианту arch-v3 (SBPF v3): пока фича не активна,
    // такой `.so` на кластер не встанет.
    simd: 'SBPF-v3',
    name: 'enable_sbpf_v3_deployment_and_execution',
    id: '5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC',
    source: 'feature-set v4.2.2:1231',
  },
]);

/**
 * Состояние фичи по аккаунту: `Feature { activated_at: Option<Slot> }`
 * сериализуется bincode как тег (1 Б) + слот (u64 LE, если активирована).
 */
export function parseFeatureState(account) {
  if (!account?.value) return { state: 'нет в кластере', slot: null };
  const data = Buffer.from(account.value.data[0], 'base64');
  if (data.length < 1) return { state: 'пустой аккаунт', slot: null };
  if (data[0] === 0) return { state: 'отложена', slot: null };
  const slot = data.length >= 9 ? Number(data.readBigUInt64LE(1)) : null;
  return { state: 'активна', slot };
}

function parseArgs(argv) {
  let rpc = 'https://api.devnet.solana.com';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rpc') rpc = argv[++i];
    else throw new Error(`Неизвестный аргумент: ${argv[i]}`);
  }
  return { rpc };
}

async function main() {
  const { rpc } = parseArgs(process.argv.slice(2));
  if (/mainnet/i.test(rpc)) throw new Error(`mainnet запрещён (R1): получен RPC ${rpc}`);
  const version = await rpcCall(rpc, 'getVersion', []).catch(() => null);
  const features = [];
  for (const feature of FEATURES) {
    const account = await rpcCall(rpc, 'getAccountInfo', [
      feature.id,
      { encoding: 'base64', dataSlice: { offset: 0, length: 9 } },
    ]);
    const { state, slot } = parseFeatureState(account);
    features.push({ simd: feature.simd, name: feature.name, id: feature.id, state, slot, source: feature.source });
  }
  const payload = { rpc, clusterVersion: version?.['solana-core'] ?? null, features };
  console.log(`::notice title=ares-features::${JSON.stringify(payload)}`);
  console.log(JSON.stringify(payload, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  main().catch((error) => {
    console.log(`::error title=ares-features-error::${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 900)}`);
    console.error(`probe-features: ошибка: ${error.message}`);
    process.exit(2);
  });
}
