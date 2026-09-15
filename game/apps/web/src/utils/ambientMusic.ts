// Фоновый трек ARES-1: Cipher — Kevin MacLeod (incompetech.com), CC BY 4.0.
// https://creativecommons.org/licenses/by/4.0/ — свободное использование
// с указанием автора (атрибуция в UI настроек и README).
// public/music/cipher.mp3 играет по кругу через AudioBufferSourceNode.
const TRACK_URL = '/music/cipher.mp3'

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

export const ambientMusic = {
 start: () => {
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
 },

 stop: () => {
  if (source) {
   try {
    source.stop()
   } catch {
    // уже остановлен
   }
   source = null
  }
  isPlaying = false
 },

 setVolume: (v: number) => {
  volume = Math.max(0, Math.min(1, v))
  if (masterGain) masterGain.gain.value = volume
 },

 isPlaying: () => isPlaying,
 getVolume: () => volume,
}
