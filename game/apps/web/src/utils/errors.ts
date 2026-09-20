import { t } from '../i18n'
import idl from '../idl.json'

interface IdlError {
 code: number
 name: string
 msg?: string
}

const IDL_ERRORS = new Map<number, IdlError>(
 ((idl as { errors?: IdlError[] }).errors ?? []).map((e) => [e.code, e]),
)

/** Player-facing translations of the on-chain error codes. */
const RU: Record<string, string> = {
 AlreadyClaimed: 'Награда уже получена.',
 BadProof: 'Не выполнены условия награды.',
 Paused: 'Игра на паузе. Попробуй позже.',
 FieldInactive: 'Поле неактивно.',
 NothingToHarvest: 'Пока нечего собирать.',
 HarvestTooSoon: 'Слишком рано: между сборами должно пройти минимум 60 секунд.',
 MaxLevelReached: 'Достигнут максимальный уровень поля.',
 Unauthorized: 'Нет прав на это действие.',
 InvalidAuthority: 'Некорректный адрес нового администратора.',
 InvalidFieldType: 'Неверный тип поля.',
 InvalidAmount: 'Неверная сумма.',
 OrderTooSmall: 'Минимальный ордер — 10 POTATO.',
 InvalidPrice: 'Укажи цену больше нуля.',
 OrderNotActive: 'Ордер уже неактивен (куплен, отменён или истёк).',
 OrderExpired: 'Срок ордера истёк.',
 OrderNotExpired: 'Ордер ещё не истёк.',
 SelfTradeBlocked: 'Нельзя купить собственный ордер.',
 CancelCooldown: 'После отмены ордера новые можно выставлять только через 3 часа.',
 RewardTooLarge: 'Награда слишком большая.',
 EpochCapExceeded: 'Дневной лимит эмиссии исчерпан — урожай можно будет собрать в следующей эпохе.',
 CapTooHigh: 'Дневной лимит нельзя поднять выше 250 000 POTATO.',
 MultiplierTooHigh: 'Глобальный множитель слишком велик.',
 EpochNotOver: 'Эпоха ещё не закончилась.',
 MathOverflow: 'Переполнение при расчёте.',
 InvalidMint: 'Токен-аккаунт не соответствует $POTATO.',
 OrderTotalTooSmall: 'Минимальный ордер: 10 POTATO и сумма от 0.001 SOL. Подними цену или количество.',
 PrepayLimitReached: 'Лимит предоплаты: налог до 28 дней, удобрение до 7 дней вперёд.',
 NothingToRepair: 'Целостность уже максимальная.',
 MaxSupplyReached: 'Достигнут максимальный supply $POTATO.',
}

/** Anchor built-in error codes we expect players to hit. */
const ANCHOR_RU: Record<number, string> = {
 2001: 'Аккаунт не соответствует ожидаемому (проверь кошелёк и mint).',
 2003: 'Не совпадает адрес аккаунта — обнови страницу.',
 2006: 'Неверный PDA — обнови страницу.',
 3012: 'Аккаунт ещё не создан — нужен $POTATO-кошелёк (создаётся автоматически при первом сборе).',
}

export function isRateLimited(err: unknown): boolean {
 const msg = messageOf(err)
 return /429|too many requests|rate limit/i.test(msg)
}

export function isUserRejection(err: unknown): boolean {
 return /user rejected|rejected the request|отклон/i.test(messageOf(err))
}

function messageOf(err: unknown): string {
 if (typeof err === 'string') return err
 if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
 return String(err)
}

/** Turns any wallet / RPC / program error into a short Russian message. */
export function describeError(err: unknown): string {
 const raw = messageOf(err)
 if (isUserRejection(err)) return t('Транзакция отклонена в кошельке.')
 if (isRateLimited(err)) return t('RPC перегружен (429). Подожди несколько секунд и повтори.')
 if (/insufficient (lamports|funds)|Attempt to debit an account but found no record/i.test(raw)) {
  return t('Недостаточно SOL на комиссии сети или аренды аккаунта.')
 }
 if (/insufficient funds/i.test(raw) && /Token/i.test(raw)) return t('Недостаточно $POTATO.')
 if (/blockhash not found|block height exceeded/i.test(raw)) return t('Сеть не подтвердила транзакцию вовремя. Повтори.')

 const custom = raw.match(/custom program error: 0x([0-9a-fA-F]+)/)
 const numbered = raw.match(/Error Number: (\d+)/)
 const code = custom ? parseInt(custom[1], 16) : numbered ? parseInt(numbered[1], 10) : null
 if (code !== null) {
  const idlErr = IDL_ERRORS.get(code)
  if (idlErr && RU[idlErr.name]) return t(RU[idlErr.name])
  if (ANCHOR_RU[code]) return t(ANCHOR_RU[code])
  // 0x1 from the SPL token program = insufficient funds
  if (code === 1 && /Token|spl/i.test(raw)) return t('Недостаточно $POTATO на балансе.')
  if (idlErr?.msg) return idlErr.msg
  return t('Ошибка программы (код {code}).', { code })
 }
 const anchorMsg = raw.match(/Error Message: ([^.]+)\./)
 if (anchorMsg) return anchorMsg[1]
 return raw.length > 160 ? raw.slice(0, 157) + '…' : raw || t('Неизвестная ошибка.')
}
