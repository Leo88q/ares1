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
const RU: Record<number, string> = {
 6000: 'Игра на паузе. Попробуй позже.',
 6001: 'Поле неактивно.',
 6002: 'Пока нечего собирать.',
 6003: 'Слишком рано: между сборами должно пройти минимум 60 секунд.',
 6004: 'Достигнут максимальный уровень поля.',
 6005: 'Нет прав на это действие.',
 6006: 'Некорректный адрес нового администратора.',
 6007: 'Неверный тип поля.',
 6008: 'Неверная сумма.',
 6009: 'Минимальный ордер — 0.1 POTATO.',
 6010: 'Укажи цену больше нуля.',
 6011: 'Ордер уже неактивен (куплен, отменён или истёк).',
 6012: 'Срок ордера истёк.',
 6013: 'Ордер ещё не истёк.',
 6014: 'Нельзя купить собственный ордер.',
 6015: 'После отмены ордера новые можно выставлять только через 3 часа.',
 6016: 'Награда слишком большая.',
 6017: 'Дневной лимит эмиссии исчерпан — урожай можно будет собрать в следующей эпохе.',
 6018: 'Дневной лимит нельзя поднять выше 250 000 POTATO.',
 6019: 'Глобальный множитель слишком велик.',
 6020: 'Эпоха ещё не закончилась.',
 6021: 'Переполнение при расчёте.',
 6022: 'Токен-аккаунт не соответствует $POTATO.',
 6026: 'Минимальный ордер: 10 POTATO и сумма от 1 SKR. Подними цену или количество.',
 6027: 'Лимит предоплаты: налог до 28 дней, удобрение до 7 дней вперёд.',
 6028: 'Целостность уже максимальная.',
 6029: 'Достигнут максимальный supply $POTATO.',
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
 if (isUserRejection(err)) return 'Транзакция отклонена в кошельке.'
 if (isRateLimited(err)) return 'RPC перегружен (429). Подожди несколько секунд и повтори.'
 if (/insufficient (lamports|funds)|Attempt to debit an account but found no record/i.test(raw)) {
  return 'Недостаточно SKR на комиссии сети или аренды аккаунта.'
 }
 if (/insufficient funds/i.test(raw) && /Token/i.test(raw)) return 'Недостаточно $POTATO.'
 if (/blockhash not found|block height exceeded/i.test(raw)) return 'Сеть не подтвердила транзакцию вовремя. Повтори.'

 const custom = raw.match(/custom program error: 0x([0-9a-fA-F]+)/)
 const numbered = raw.match(/Error Number: (\d+)/)
 const code = custom ? parseInt(custom[1], 16) : numbered ? parseInt(numbered[1], 10) : null
 if (code !== null) {
  if (RU[code]) return RU[code]
  if (ANCHOR_RU[code]) return ANCHOR_RU[code]
  // 0x1 from the SPL token program = insufficient funds
  if (code === 1 && /Token|spl/i.test(raw)) return 'Недостаточно $POTATO на балансе.'
  const idlErr = IDL_ERRORS.get(code)
  if (idlErr?.msg) return idlErr.msg
  return `Ошибка программы (код ${code}).`
 }
 const anchorMsg = raw.match(/Error Message: ([^.]+)\./)
 if (anchorMsg) return anchorMsg[1]
 return raw.length > 160 ? raw.slice(0, 157) + '…' : raw || 'Неизвестная ошибка.'
}
