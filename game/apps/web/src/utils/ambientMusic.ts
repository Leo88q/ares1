// Фоновый трек ARES-1: Cipher — Kevin MacLeod (incompetech.com), CC BY 4.0.
// https://creativecommons.org/licenses/by/4.0/ — свободное использование
// с указанием автора (атрибуция в UI настроек и README).
// public/music/cipher.mp3 играет по кругу через AudioBufferSourceNode.
//
// Музыка ГЛОБАЛЬНАЯ: жизненный цикл не зависит от экрана/компонентов.
// Настройки (вкл/громкость) живут в localStorage, инициализация — один раз
// в App (ambientMusic.init()).
const TRACK_URL = '/music/cipher.mp3'
const ON_KEY = 'potato_music'
const VOL_KEY = 'potato_music_volume'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let buffer: AudioBuffer | null = null
let loading: Promise<AudioBuffer | null> | null = null
let source: AudioBufferSourceNode | null = null
let isPlaying = false
let volume = 0.15

const getCtx = (): AudioContext => {
 if (!ctx) {
  ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  masterGain = ctx.createGain()
  masterGain.gain.value = volume
  masterGain.connect(ctx.destination)
 }
 return ctx
}

const loadTrack = async (): Promise<AudioBuffer | null> => {
 if (buffer) return buffer
 if (loading) return loading
 loading = (async () => {
  try {
   const ac = getCtx()
   const res = await fetch(TRACK_URL)
   if (!res.ok) throw new Error(`http ${res.status}`)
   buffer = await ac.decodeAudioData(await res.arrayBuffer())
   return buffer
  } catch {
   return null
  } finally {
   loading = null
  }
 })()
 return loading
}

const readOn = (): boolean => {
 try {
  return localStorage.getItem(ON_KEY) === 'on'
 } catch {
  return false
 }
}

const readVolume = (): number => {
 try {
  const v = parseFloat(localStorage.getItem(VOL_KEY) || '0.15')
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.15
 } catch {
  return 0.15
 }
}

const start = () => {
 if (isPlaying) return
 void loadTrack().then((buf) => {
  if (!buf || isPlaying) return
  try {
   const ac = getCtx()
   if (ac.state === 'suspended') void ac.resume()
   source = ac.createBufferSource()
   source.buffer = buf
   source.loop = true
   source.connect(masterGain!)
   source.start()
   isPlaying = true
  } catch {
   // аудио недоступно — молча пропускаем
  }
 })
}

const stop = () => {
 if (source) {
  try {
   source.stop()
  } catch {
   // уже остановлен
  }
  source = null
 }
 isPlaying = false
}

let inited = false

export const ambientMusic = {
 // Один раз при старте приложения (в App): читает настройки и включает трек,
 // если он был включён ранее. Если браузер заблокировал автовоспроизведение,
 // повторный старт произойдёт при первом взаимодействии пользователя.
 init: () => {
  if (inited) return
  inited = true
  volume = readVolume()
  if (readOn()) start()
  const onFirstGesture = () => {
   if (readOn()) start()
  }
  window.addEventListener('pointerdown', onFirstGesture, { once: true })
  window.addEventListener('keydown', onFirstGesture, { once: true })
 },

 setOn: (on: boolean) => {
  try {
   localStorage.setItem(ON_KEY, on ? 'on' : 'off')
  } catch {
   // приватный режим
  }
  if (on) start()
  else stop()
 },

 setVolume: (v: number) => {
  volume = Math.max(0, Math.min(1, v))
  try {
   localStorage.setItem(VOL_KEY, volume.toString())
  } catch {
   // приватный режим
  }
  if (masterGain) masterGain.gain.value = volume
 },

 getOn: readOn,
 getVolume: readVolume,
 isPlaying: () => isPlaying,
}
