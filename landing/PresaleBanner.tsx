/**
 * Баннер Phase 1: офф-чейн предоплата за ограниченные паки.
 *
 * Это витрина + форма, а не кошелёк: покупатель резервирует заказ, получает
 * точную сумму и адрес казны, переводит вручную и присылает подпись. Зачисление
 * POTATO — в день листинга на mainnet (см. Terms §7). Никаких escrow/возвратов.
 *
 * API-базу берём из VITE_PRESALE_API, иначе относительный /api/presale
 * (реверс-прокси маршрутизирует на бэкенд).
 */
import { useEffect, useState } from 'react';
import { t } from './i18n';
import './presale-banner.css';

const API = (import.meta.env.VITE_PRESALE_API as string | undefined) ?? '/api/presale';
const RUN_ID = (import.meta.env.VITE_PRESALE_RUN as string | undefined) ?? 'phase1';

interface Pack { id: string; titleRu: string; titleEn: string; fields: number; potatoMicro: string }
/**
 * Формат — публичный контракт `GET /api/presale/runs/:runId` (camelCase,
 * см. `publicRunStatus()` в бэкенде). Раньше здесь был доменный snake_case,
 * и счётчик с ценой молча показывали NaN/undefined.
 */
interface RunStatus {
  runId: string
  packId: string
  currency: 'sol' | 'skr'
  cap: number
  reservedCount: number
  remaining: number
  isOpen: boolean
  soldOut: boolean
  priceUnits: string
  unitsPerWhole: string
  packPotatoMicro: string
}

type Step = 'idle' | 'reserved' | 'paid' | 'error';

/**
 * Базовая единица → человеческий вид. Цена в тираже хранится в лампортах (SOL)
 * или атомах (SKR), как их считает RPC; смешивать их нельзя (RFC §12.4), поэтому
 * разрядность берётся из валюты тиража, а не угадывается по числу.
 */
function formatOfferPrice(units: string, currency: string): string {
  const decimals = currency === 'sol' ? 9 : 6;
  const value = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${frac ? `${whole}.${frac}` : whole.toString()} ${currency.toUpperCase()}`;
}

export function PresaleBanner() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [packId, setPackId] = useState('');
  const [wallet, setWallet] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [msg, setMsg] = useState('');
  const [order, setOrder] = useState<{ orderNo: number; payUnits: string; treasury: string; currency: string } | null>(null);
  const [signature, setSignature] = useState('');

  useEffect(() => {
    fetch(`${API}/packs`).then(r => r.json()).then(d => {
      const list: Pack[] = d.packs ?? [];
      setPacks(list);
      if (list[0]) setPackId(list[0].id);
    }).catch(() => setMsg(t('Каталог паков недоступен — попробуйте позже')));
    fetch(`${API}/runs/${RUN_ID}`).then(r => r.json()).then(d => setRun(d.run ?? null)).catch(() => {});
  }, []);

  const reserve = async () => {
    setStep('idle'); setMsg('');
    try {
      const res = await fetch(`${API}/runs/${RUN_ID}/reserve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, email: email || null }),
      });
      const d = await res.json();
      if (!res.ok) { setStep('error'); setMsg(d.message ?? d.error ?? 'Ошибка резерва'); return; }
      setOrder({ orderNo: d.orderNo, payUnits: d.payUnits, treasury: d.treasury, currency: d.currency });
      setStep('reserved');
    } catch { setStep('error'); setMsg(t('Не удалось связаться с сервером')); }
  };

  const attach = async () => {
    if (!order) return;
    setMsg('');
    try {
      const res = await fetch(`${API}/runs/${RUN_ID}/orders/${order.orderNo}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, wallet }),
      });
      const d = await res.json();
      if (!res.ok) { setStep('error'); setMsg(d.message ?? 'Ошибка'); return; }
      setStep('paid');
      setMsg(t('Подпись получена — проверяем перевод. Статус заказа: №{n}', { n: order.orderNo }));
    } catch { setStep('error'); setMsg(t('Не удалось связаться с сервером')); }
  };

  const remaining = run ? Math.max(0, run.cap - run.reservedCount) : null;

  return (
    <section className="ps-banner" id="presale">
      <div className="ps-art">
        <img src="/ares/case-sealed.png" alt="" className="ps-case" />
      </div>
      <div className="ps-body">
        <span className="ps-eyebrow">{t('PHASE 1 · ПРЕДОПЛАТА')}</span>
        <h2 className="ps-title">{t('Ограниченные паки ARES-1')}</h2>
        <p className="ps-sub">
          {t('500 паков по предоплате сейчас + 500 на старте mainnet. Зачисление POTATO — в день листинга на mainnet. Без возвратов.')}
        </p>

        {run && (
          <p className="ps-price">
            {t('Цена пака: {price}', { price: formatOfferPrice(run.priceUnits, run.currency) })}
          </p>
        )}

        {remaining !== null && (
          <p className="ps-counter">{t('Осталось: {n} из {cap}', { n: remaining, cap: run!.cap })}</p>
        )}

        <div className="ps-packs">
          {packs.map(p => (
            <label key={p.id} className={`ps-pack ${packId === p.id ? 'is-active' : ''}`}>
              <input type="radio" name="pack" value={p.id} checked={packId === p.id} onChange={() => setPackId(p.id)} />
              <span className="ps-pack-name">{p.titleRu}</span>
              <span className="ps-pack-meta">{p.fields} {t('полей')} · {Number(p.potatoMicro) / 1e6} POTATO</span>
            </label>
          ))}
        </div>

        {step !== 'reserved' && step !== 'paid' && (
          <div className="ps-form">
            <input className="ps-input" placeholder={t('Адрес кошелька (SOL)')} value={wallet} onChange={e => setWallet(e.target.value)} />
            <input className="ps-input" placeholder={t('Email (необязательно)')} value={email} onChange={e => setEmail(e.target.value)} />
            <button className="ps-cta" onClick={reserve} disabled={!wallet || !packId}>
              {t('Зарезервировать пак')}
            </button>
          </div>
        )}

        {step === 'reserved' && order && (
          <div className="ps-instructions">
            <p>{t('Заказ №{n} зарезервирован', { n: order.orderNo })}</p>
            <p className="ps-mono">{t('Переведите ровно {u} базовых единиц на:', { u: order.payUnits })}</p>
            <code className="ps-addr">{order.treasury}</code>
            <input className="ps-input" placeholder={t('Подпись транзакции')} value={signature} onChange={e => setSignature(e.target.value)} />
            <button className="ps-cta" onClick={attach} disabled={!signature}>{t('Я оплатил — проверить')}</button>
          </div>
        )}

        {step === 'paid' && <p className="ps-ok">{msg}</p>}
        {step === 'error' && <p className="ps-err">{msg}</p>}

        <p className="ps-legal">
          {t('Предоплата не является инвестицией и не гарантирует доход. Условия — Terms §7.')}
        </p>
      </div>
    </section>
  );
}
