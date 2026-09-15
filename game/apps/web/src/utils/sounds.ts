// Кастомные SFX ARES-1: пререндеренные сэмплы (public/sfx/*.wav) —
// «марсианская колония / гидропоника / ретро-HUD» вместо стандартных бипов.
// API прежнего модуля сохранён: sounds.<имя>() / toggleSounds / isSoundEnabled.
let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let enabled = true
const cache = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer | null>>()

const SFX: Record<string, string> = {
 harvest: '/sfx/harvest.wav',
 buyField: '/sfx/buyfield.wav',
 buy: '/sfx/buy.wav',
 repair: '/sfx/repair.wav',
 upgrade: '/sfx/upgrade.wav',
 payTax: '/sfx/paytax.wav',
 fertilizer: '/sfx/fertilizer.wav',
 achievement: '/sfx/achievement.wav',
 click: '/sfx/click.wav',
 error: '/sfx/error.wav',
 success: '/sfx/success.wav',
 walletConnect: '/sfx/walletconnect.wav',
 navigate: '/sfx/navigate.wav',
 reward: '/sfx/reward.wav',
}

// Громкость каждого сэмпла (сэмплы нормированы до 0.5 пика — сюда можно давить громче).
const VOLUME: Record<string, number> = {
 harvest: 0.9,
 buyField: 0.85,
 buy: 0.8,
 repair: 0.8,
 upgrade: 0.85,
 payTax: 0.75,
 fertilizer: 0.8,
 achievement: 0.8,
 click: 0.5,
 error: 0.8,
 success: 0.85,
 walletConnect: 0.8,
 navigate: 0.55,
 reward: 0.85,
}

const getCtx = (): AudioContext => {
 if (!ctx) {
  ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  masterGain = ctx.createGain()
  masterGain.gain.value = 1
  masterGain.connect(ctx.destination)
 }
 return ctx
}

export const toggleSounds = () => {
 enabled = !enabled
 return enabled
}

export const isSoundEnabled = () => enabled

const load = async (name: string): Promise<AudioBuffer | null> => {
 const key = SFX[name]
 if (!key) return null
 const hit = cache.get(key)
 if (hit) return hit
 const inFlight = pending.get(key)
 if (inFlight) return inFlight
 const p = (async () => {
  try {
   const ac = getCtx()
   const res = await fetch(key)
   if (!res.ok) throw new Error(`http ${res.status}`)
   const buf = await ac.decodeAudioData(await res.arrayBuffer())
   cache.set(key, buf)
   return buf
  } catch {
   return null
  } finally {
   pending.delete(key)
  }
 })()
 pending.set(key, p)
 return p
}

const play = (name: string, volumeScale = 1) => {
 if (!enabled) return
 void load(name).then((buffer) => {
  if (!buffer) return
  try {
   const ac = getCtx()
   if (ac.state === 'suspended') void ac.resume()
   const src = ac.createBufferSource()
   src.buffer = buffer
   const gain = ac.createGain()
   gain.gain.value = (VOLUME[name] ?? 0.8) * volumeScale
   src.connect(gain)
   gain.connect(masterGain!)
   src.start()
  } catch {
   // аудио недоступно — молча пропускаем
  }
 })
}

export const sounds = {
 // Сбор урожая — «бульк» картошки + восходящий планк + шкворч
 harvest: () => play('harvest'),
 // Покупка поля — механический «клёц-шип» + колокол
 buyField: () => play('buyField'),
 // Покупка ордера — монетка с металлическим кольцом
 buy: () => play('buy'),
 // Техремонт — два удара молотка
 repair: () => play('repair'),
 // Улучшение — «пайер-ап» свип + шиммер
 upgrade: () => play('upgrade'),
 // Пошлина — кассовый клик-бзз
 payTax: () => play('payTax'),
 // Удобрение — булькающие капли
 fertilizer: () => play('fertilizer'),
 // Достижение — ретро-фанфары
 achievement: () => play('achievement'),
 // Клик — мягкий механический тик
 click: () => play('click'),
 // Ошибка — низкий «буз-донк»
 error: () => play('error'),
 // Успех — яркий «динг»
 success: () => play('success'),
 // Подключение кошелька — «линк» + восходящий чим
 walletConnect: () => play('walletConnect'),
 // Переход между экранами — тихий «вух»
 navigate: () => play('navigate'),
 // Получение награды — «подарок»-арпедж
 reward: () => play('reward'),
}
