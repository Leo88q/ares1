let ctx: AudioContext | null = null
let enabled = true

const getCtx = () => {
 if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
 return ctx
}

export const toggleSounds = () => {
 enabled = !enabled
 return enabled
}

export const isSoundEnabled = () => enabled

function play(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15, delay = 0) {
 if (!enabled) return
 try {
  const ac = getCtx()
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, ac.currentTime + delay)
  gain.gain.linearRampToValueAtTime(volume, ac.currentTime + delay + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(ac.currentTime + delay)
  osc.stop(ac.currentTime + delay + duration)
 } catch {}
}

function playNoise(duration: number, volume = 0.05, delay = 0) {
 if (!enabled) return
 try {
  const ac = getCtx()
  const bufferSize = ac.sampleRate * duration
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
   data[i] = (Math.random() - 0.5) * 2
  }
  const source = ac.createBufferSource()
  source.buffer = buffer
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0, ac.currentTime + delay)
  gain.gain.linearRampToValueAtTime(volume, ac.currentTime + delay + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration)
  const filter = ac.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1000
  source.connect(filter)
  filter.connect(gain)
  gain.connect(ac.destination)
  source.start(ac.currentTime + delay)
 } catch {}
}

export const sounds = {
 // Сбор урожая - восходящая мелодия
 harvest: () => {
  play(523, 0.12, 'sine', 0.2, 0)   // C5
  play(659, 0.12, 'sine', 0.2, 0.08)  // E5
  play(784, 0.15, 'sine', 0.2, 0.16)  // G5
  play(1047, 0.25, 'triangle', 0.15, 0.24) // C6 (финальная нота)
 },

 // Покупка поля - приятный аккорд
 buyField: () => {
  play(440, 0.15, 'triangle', 0.15, 0) // A4
  play(554, 0.15, 'triangle', 0.12, 0.1) // C#5
  play(659, 0.2, 'triangle', 0.15, 0.2) // E5
 },

 // Покупка ордера - монетка
 buy: () => {
  play(988, 0.08, 'square', 0.1, 0)
  play(1319, 0.15, 'square', 0.1, 0.06)
 },

 // Техремонт - звук молотка
 repair: () => {
  playNoise(0.08, 0.15, 0)
  play(220, 0.1, 'sawtooth', 0.1, 0)
  playNoise(0.08, 0.12, 0.2)
  play(330, 0.1, 'sawtooth', 0.08, 0.2)
 },

 // Улучшение - магический звук
 upgrade: () => {
  play(392, 0.1, 'sine', 0.15, 0)  // G4
  play(523, 0.1, 'sine', 0.15, 0.08) // C5
  play(659, 0.1, 'sine', 0.15, 0.16) // E5
  play(784, 0.1, 'sine', 0.15, 0.24) // G5
  play(1047, 0.3, 'sine', 0.2, 0.32) // C6
 },

 // Пошлина - короткий звон монет
 payTax: () => {
  play(1318, 0.1, 'triangle', 0.12, 0)
  play(1568, 0.1, 'triangle', 0.12, 0.08)
  play(1760, 0.15, 'triangle', 0.15, 0.16)
 },

 // Удобрение - капельки
 fertilizer: () => {
  play(880, 0.08, 'sine', 0.1, 0)
  play(1108, 0.08, 'sine', 0.1, 0.1)
  play(1396, 0.08, 'sine', 0.1, 0.2)
  play(1760, 0.12, 'sine', 0.12, 0.3)
 },

 // Достижение - фанфары
 achievement: () => {
  play(523, 0.15, 'sawtooth', 0.12, 0)
  play(659, 0.15, 'sawtooth', 0.12, 0.12)
  play(784, 0.15, 'sawtooth', 0.12, 0.24)
  play(1047, 0.4, 'sawtooth', 0.18, 0.36)
  playNoise(0.1, 0.05, 0.36)
 },

 // Клик - короткий тактильный
 click: () => {
  play(800, 0.04, 'square', 0.06, 0)
 },

 // Ошибка - мягкий buzz
 error: () => {
  play(196, 0.15, 'sawtooth', 0.1, 0)
  play(185, 0.15, 'sawtooth', 0.1, 0.1)
 },

 // Успех - ding
 success: () => {
  play(1318, 0.12, 'sine', 0.15, 0)
  play(1568, 0.2, 'sine', 0.15, 0.1)
 },

 // Подключение кошелька
 walletConnect: () => {
  play(523, 0.1, 'triangle', 0.12, 0)
  play(659, 0.1, 'triangle', 0.12, 0.08)
  play(784, 0.2, 'triangle', 0.15, 0.16)
 },

 // Переход между экранами
 navigate: () => {
  play(600, 0.05, 'sine', 0.08, 0)
 },

 // Получение награды
 reward: () => {
  play(659, 0.1, 'triangle', 0.12, 0)
  play(784, 0.1, 'triangle', 0.12, 0.08)
  play(1047, 0.25, 'triangle', 0.15, 0.16)
 },
}
