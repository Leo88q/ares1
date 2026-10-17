/**
 * Панель слотов грядок поля (S7, шаг 5). Показывается только при SLOTS_ENABLED и полной конфигурации
 * (см. slots/config.ts). Бесплатные слоты 1–6 занимаются подписью запроса; платные 7–12 сначала
 * оплачиваются SKR на казну. Подпись платежа сохраняется до запроса выдачи: при сбое сети
 * выдача повторяется по той же оплате, без второго списания.
 */
import { useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { t } from '../i18n'
import { getItem, setItem } from '../utils/consent'
import { SKR_MINT } from '../utils/anchorClient'
import { BACKEND_URL } from '../contexts/SolanaContext'
import { SLOT_PRICE_UNITS, SLOT_TREASURY_OWNER } from './config'
import { postSlotGrant } from './api'
import type { SlotRecordView } from './api'
import { SKR_DECIMALS, formatSkr, isPaidSlot, slotNumbers, slotRequestMessage } from './protocol'
import './slots.css'

const grantKey = (fieldId: string, slot: number) => `ares-slot:${fieldId}:${slot}`
const payKey = (fieldId: string, slot: number) => `ares-slot-pay:${fieldId}:${slot}`

interface Stored { record: SlotRecordView; signature: string }

function readGrant(fieldId: string, slot: number): Stored | null {
  const raw = getItem('functional', grantKey(fieldId, slot))
  if (!raw) return null
  try { return JSON.parse(raw) as Stored } catch { return null }
}

function errorText(code: string): string {
  if (code === 'SLOT_TAKEN') return t('Слот уже занят другим владельцем. Оплата передана оператору на проверку.')
  if (code === 'PAYMENT_ALREADY_USED') return t('Эта оплата уже использована для другого слота.')
  if (code === 'PAYMENT_NOT_FOUND') return t('Платёж ещё не виден в сети финально. Повторите через минуту: оплата сохранена.')
  if (code === 'AUTH_STALE') return t('Подпись устарела. Нажмите ещё раз.')
  if (code === 'AUTH_BAD_SIGNATURE') return t('Кошелёк не подтвердил запрос.')
  if (code === 'NETWORK') return t('Сервер недоступен. Оплата сохранена: повторите выдачу без новой оплаты.')
  if (code.startsWith('PAYMENT_')) return t('Сервер не принял платёж. Оплата не засчитана.')
  return t('Не удалось выдать слот. Повторите позже.')
}

// Коды, после которых сохранённая оплата больше не нужна: повтор с ней бессмыслен.
const PAYMENT_SPENT = new Set(['PAYMENT_ALREADY_USED', 'PAYMENT_AMOUNT_NOT_EXACT', 'PAYMENT_WRONG_MINT', 'PAYMENT_PAYER_NOT_SOURCE', 'PAYMENT_TX_FAILED', 'PAYMENT_BLOCK_TOO_OLD'])

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export default function SlotsPanel({ fieldId }: { fieldId: string }) {
  const { publicKey, connected, sendTransaction, signMessage } = useWallet()
  const { connection } = useConnection()
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ slot: number; ok: boolean; text: string } | null>(null)
  const [, refresh] = useState(0)

  const canAct = connected && !!publicKey && !!signMessage && busySlot === null

  async function sendPayment(): Promise<{ signature: string; blockhash: string; lastValidBlockHeight: number }> {
    if (!publicKey || !sendTransaction || SLOT_PRICE_UNITS === null) throw new Error('NO_WALLET')
    const mintInfo = await connection.getAccountInfo(SKR_MINT)
    if (!mintInfo) throw new Error('MINT_NOT_FOUND')
    const programId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    if (!mintInfo.owner.equals(programId)) throw new Error('MINT_PROGRAM_UNKNOWN')
    const treasury = new PublicKey(SLOT_TREASURY_OWNER)
    const source = getAssociatedTokenAddressSync(SKR_MINT, publicKey, false, programId)
    const dest = getAssociatedTokenAddressSync(SKR_MINT, treasury, true, programId)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(
      createAssociatedTokenAccountIdempotentInstruction(publicKey, dest, treasury, SKR_MINT, programId),
      createTransferCheckedInstruction(source, SKR_MINT, dest, publicKey, SLOT_PRICE_UNITS, SKR_DECIMALS, [], programId),
    )
    const signature = await sendTransaction(tx, connection, { skipPreflight: false })
    return { signature, blockhash, lastValidBlockHeight }
  }

  async function claim(slot: number) {
    if (!publicKey || !signMessage) return
    setBusySlot(slot)
    setNotice(null)
    try {
      let payment: string | null = null
      if (isPaidSlot(slot)) {
        payment = getItem('functional', payKey(fieldId, slot)) || null
        if (!payment) {
          const sent = await sendPayment()
          // Подпись оплаты сохраняем сразу после отправки: если дальше сбой, повтор не спишет дважды.
          setItem('functional', payKey(fieldId, slot), sent.signature)
          payment = sent.signature
          const done = await connection.confirmTransaction(
            { signature: sent.signature, blockhash: sent.blockhash, lastValidBlockHeight: sent.lastValidBlockHeight },
            'finalized',
          )
          if (done.value.err) throw new Error('PAYMENT_TX_FAILED')
        }
      }
      const fields = { field_id: fieldId, slot, wallet: publicKey.toBase58(), payment_signature: payment }
      const ts = Math.floor(Date.now() / 1000)
      const sig = await signMessage(new TextEncoder().encode(slotRequestMessage(fields, ts)))
      const res = await postSlotGrant(BACKEND_URL, { ...fields, ts, sig: toBase64(sig) })
      if (res.ok) {
        setItem('functional', grantKey(fieldId, slot), JSON.stringify({ record: res.record, signature: res.signature }))
        setItem('functional', payKey(fieldId, slot), '')
        setNotice({ slot, ok: true, text: t('Слот {n} выдан. Запись действует 1 час.', { n: slot }) })
      } else {
        if (payment && PAYMENT_SPENT.has(res.error)) setItem('functional', payKey(fieldId, slot), '')
        setNotice({ slot, ok: false, text: errorText(res.error) })
      }
    } catch (error) {
      const name = error instanceof Error ? error.message : ''
      const rejected = /reject|cancel|declin|denied/i.test(name)
      setNotice({
        slot,
        ok: false,
        text: rejected
          ? t('Действие отменено в кошельке.')
          : name === 'PAYMENT_TX_FAILED' ? t('Оплата не прошла в сети. Списания не произошло.')
          : t('Не удалось выдать слот. Повторите позже.'),
      })
    } finally {
      setBusySlot(null)
      refresh(n => n + 1)
    }
  }

  return (
    <section className="sl-panel" aria-label={t('Слоты грядок')} data-testid="slots-panel">
      <h3 className="sl-title">{t('Слоты грядок')}</h3>
      <p className="sl-note">{t('Слоты 1–6 бесплатны, 7–12 оплачиваются SKR. Сервер выдаёт запись по подписи кошелька. Занятость другим владельцем видна после попытки.')}</p>
      {!connected && <p className="sl-note">{t('Подключите кошелёк, чтобы занять слот.')}</p>}
      {connected && !signMessage && <p className="sl-error" role="alert">{t('Кошелёк не поддерживает подпись сообщений.')}</p>}
      <ul className="sl-grid">
        {slotNumbers().map(slot => {
          const own = readGrant(fieldId, slot)
          const paid = isPaidSlot(slot)
          return (
            <li key={slot} className="sl-item">
              <span className="sl-slot">{t('Слот {n}', { n: slot })}</span>
              <span className="sl-price">{paid && SLOT_PRICE_UNITS !== null ? t('{amount} SKR', { amount: formatSkr(SLOT_PRICE_UNITS) }) : t('Бесплатно')}</span>
              {own && <span className="sl-own">{t('Ваш слот')}</span>}
              <button type="button" className="sl-btn" disabled={!canAct} onClick={() => void claim(slot)}>
                {busySlot === slot ? t('В процессе…') : own ? t('Обновить запись') : paid ? t('Оплатить и занять') : t('Занять')}
              </button>
            </li>
          )
        })}
      </ul>
      {notice && <p role="status" className={notice.ok ? 'sl-ok' : 'sl-error'}>{notice.text}</p>}
    </section>
  )
}
