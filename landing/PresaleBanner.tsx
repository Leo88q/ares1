/**
 * Phase 1 information and reservation UI.
 *
 * The landing page never treats devnet tokens as money. The API decides whether
 * a particular environment may accept writes; this component also reflects the
 * public payment gate so buyers do not see a disabled sale as available.
 */
import { useEffect, useState } from 'react';
import { t } from './i18n';
import './presale-banner.css';

const API = (import.meta.env.VITE_PRESALE_API as string | undefined) ?? '/api/presale';
const RUN_ID = (import.meta.env.VITE_PRESALE_RUN as string | undefined) ?? 'wave1';

interface Pack { id: string; titleRu: string; titleEn: string; fields: number; potatoMicro: string }
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
  cluster?: 'devnet' | 'mainnet-beta'
  paymentsEnabled?: boolean
}

type Step = 'idle' | 'paid' | 'error';

/** Convert the run's exact base units into a human-readable payment amount. */
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
  const [wallet, setWallet] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [msg, setMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [order, setOrder] = useState<{ orderNo: number; payUnits: string; treasury: string; currency: string } | null>(null);
  const [signature, setSignature] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/packs`)
      .then(async response => {
        if (!response.ok) throw new Error('packs unavailable');
        return response.json();
      })
      .then(data => { if (!cancelled) setPacks(data.packs ?? []); })
      .catch(() => { if (!cancelled) setStatusMsg(t('Каталог паков недоступен — попробуйте позже')); });

    fetch(`${API}/runs/${RUN_ID}`)
      .then(async response => {
        if (!response.ok) throw new Error('run unavailable');
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        setRun(data.run ?? null);
        if (!data.run) setStatusMsg(t('Тираж сейчас не открыт. Не отправляйте платёж.'));
      })
      .catch(() => {
        if (!cancelled) setStatusMsg(t('Тираж сейчас не открыт. Не отправляйте платёж.'));
      });

    return () => { cancelled = true; };
  }, []);

  const activePack = packs.find(pack => pack.id === run?.packId) ?? null;
  const paymentsEnabled = run?.paymentsEnabled === true;
  const remaining = run ? Math.max(0, run.remaining ?? (run.cap - run.reservedCount)) : null;
  const canReserve = Boolean(run && run.isOpen && !run.soldOut && paymentsEnabled && activePack && remaining! > 0);

  const reserve = async () => {
    if (!run || !canReserve) return;
    setStep('idle'); setMsg('');
    try {
      const res = await fetch(`${API}/runs/${RUN_ID}/reserve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, email: email || null }),
      });
      const data = await res.json();
      if (!res.ok) { setStep('error'); setMsg(data.message ?? data.error ?? t('Ошибка резерва')); return; }
      setOrder({ orderNo: data.orderNo, payUnits: data.payUnits, treasury: data.treasury, currency: data.currency });
      setStep('idle');
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
      const data = await res.json();
      if (!res.ok) { setStep('error'); setMsg(data.message ?? t('Ошибка')); return; }
      setStep('paid');
      setMsg(t('Подпись получена — проверяем перевод. Статус заказа: №{n}', { n: order.orderNo }));
    } catch { setStep('error'); setMsg(t('Не удалось связаться с сервером')); }
  };

  return (
    <section className="ps-banner" id="presale">
      <div className="ps-art">
        <img src="/ares/case-sealed.png" alt="" className="ps-case" />
      </div>
      <div className="ps-body">
        <span className="ps-eyebrow">{t('PHASE 1 · ПРЕДОПЛАТА')}</span>
        <h2 className="ps-title">{t('Ограниченные паки ARES-1')}</h2>
        <p className="ps-sub">
          {t('Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.')}
        </p>

        {run?.cluster === 'devnet' && (
          <p className="ps-err">{t('Этот сервер работает в devnet: не отправляйте сюда реальные средства.')}</p>
        )}
        {run?.cluster === 'mainnet-beta' && !paymentsEnabled && (
          <p className="ps-err">{t('Пресейл mainnet пока закрыт: не отправляйте средства.')}</p>
        )}
        {statusMsg && !run && <p className="ps-err">{statusMsg}</p>}

        {run && run.cluster !== 'devnet' && (
          <p className="ps-price">
            {t('Цена пака: {price}', { price: formatOfferPrice(run.priceUnits, run.currency) })}
          </p>
        )}

        {run && run.cluster !== 'devnet' && (
          <p className="ps-counter">{t('Осталось: {n} из {cap}', { n: remaining ?? 0, cap: run.cap })}</p>
        )}

        {run && activePack && (
          <div className="ps-packs">
            <div className="ps-pack is-active">
              <span className="ps-pack-name">{activePack.titleRu}</span>
              <span className="ps-pack-meta">{activePack.fields} {t('полей')} · {Number(activePack.potatoMicro) / 1e6} POTATO</span>
            </div>
          </div>
        )}
        {run && !activePack && <p className="ps-err">{t('Пак этого тиража сейчас недоступен.')}</p>}

        {!order && step !== 'paid' && (
          <div className="ps-form">
            <input className="ps-input" placeholder={t('Адрес кошелька')} value={wallet} onChange={e => setWallet(e.target.value)} />
            <input className="ps-input" placeholder={t('Email (необязательно)')} value={email} onChange={e => setEmail(e.target.value)} />
            <button className="ps-cta" onClick={reserve} disabled={!wallet || !canReserve}>
              {t('Зарезервировать пак')}
            </button>
          </div>
        )}

        {order && step !== 'paid' && (
          <div className="ps-instructions">
            <p>{t('Заказ №{n} зарезервирован', { n: order.orderNo })}</p>
            <p className="ps-mono">{t('Переведите ровно {amount} на:', { amount: formatOfferPrice(order.payUnits, order.currency) })}</p>
            <code className="ps-addr">{order.treasury}</code>
            <input className="ps-input" placeholder={t('Подпись транзакции')} value={signature} onChange={e => setSignature(e.target.value)} />
            <button className="ps-cta" onClick={attach} disabled={!signature}>{t('Я оплатил — проверить')}</button>
          </div>
        )}

        {step === 'paid' && <p className="ps-ok">{msg}</p>}
        {step === 'error' && <p className="ps-err">{msg}</p>}

        <p className="ps-legal">
          {t('Предоплата не является инвестицией и не гарантирует доход.')}
        </p>
      </div>
    </section>
  );
}
