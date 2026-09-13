let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let isPlaying = false
let volume = 0.15
let nextNoteTime = 0
let timerId: number | null = null
let oscillators: OscillatorNode[] = []

const getCtx = () => {
 if (!ctx) {
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  masterGain = ctx.createGain()
  masterGain.gain.value = volume
  masterGain.connect(ctx.destination)
 }
 return { ctx: ctx, master: masterGain! }
}

// Пентатоника — всегда звучит приятно
const SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25]
const BASS_NOTES = [65.41, 73.42, 82.41, 98.00] // C2, D2, E2, G2

function playNote(freq: number, duration: number, when: number, type: OscillatorType = 'sine', vol = 0.3) {
 if (!ctx || !masterGain) return
 const osc = ctx.createOscillator()
 const gain = ctx.createGain()
 const filter = ctx.createBiquadFilter()
 
 osc.type = type
 osc.frequency.value = freq
 
 // Low-pass filter для мягкости
 filter.type = 'lowpass'
 filter.frequency.value = 2000
 filter.Q.value = 1
 
 // ADSR envelope
 gain.gain.setValueAtTime(0, when)
 gain.gain.linearRampToValueAtTime(vol, when + 0.1)
 gain.gain.exponentialRampToValueAtTime(0.001, when + duration)
 
 osc.connect(filter)
 filter.connect(gain)
 gain.connect(masterGain)
 
 osc.start(when)
 osc.stop(when + duration)
 
 oscillators.push(osc)
 osc.onended = () => {
  const idx = oscillators.indexOf(osc)
  if (idx > -1) oscillators.splice(idx, 1)
 }
}

function playPad(freq: number, when: number) {
 if (!ctx || !masterGain) return
 // Два осциллятора для богатого pad-звука
 for (let i = 0; i < 2; i++) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  
  osc.type = 'triangle'
  osc.frequency.value = freq * (i === 0 ? 1 : 1.002) // Detune для ширины
  
  filter.type = 'lowpass'
  filter.frequency.value = 800
  
  gain.gain.setValueAtTime(0, when)
  gain.gain.linearRampToValueAtTime(0.15, when + 0.5)
  gain.gain.linearRampToValueAtTime(0.15, when + 3.5)
  gain.gain.exponentialRampToValueAtTime(0.001, when + 4)
  
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(masterGain)
  
  osc.start(when)
  osc.stop(when + 4)
 }
}

function scheduler() {
 if (!ctx || !isPlaying) return
 
 while (nextNoteTime < ctx.currentTime + 0.1) {
  // Случайная нота из пентатоники
  const noteFreq = SCALE[Math.floor(Math.random() * SCALE.length)]
  const octave = Math.random() > 0.5 ? 1 : 2
  playNote(noteFreq * octave, 2, nextNoteTime, 'sine', 0.2)
  
  // Иногда бас
  if (Math.random() > 0.7) {
   const bassFreq = BASS_NOTES[Math.floor(Math.random() * BASS_NOTES.length)]
   playNote(bassFreq, 3, nextNoteTime, 'triangle', 0.25)
  }
  
  // Редко pad
  if (Math.random() > 0.85) {
   const padFreq = SCALE[Math.floor(Math.random() * SCALE.length)] / 2
   playPad(padFreq, nextNoteTime)
  }
  
  // Следующая нота через 1-3 секунды (разнообразие)
  nextNoteTime += 1 + Math.random() * 2
 }
 
 timerId = window.setTimeout(scheduler, 100)
}

export const ambientMusic = {
 start: () => {
  if (isPlaying) return
  const { ctx: audioCtx } = getCtx()
  
  if (audioCtx.state === 'suspended') {
   audioCtx.resume()
  }
  
  isPlaying = true
  nextNoteTime = audioCtx.currentTime
  scheduler()
 },
 
 stop: () => {
  isPlaying = false
  if (timerId !== null) {
   clearTimeout(timerId)
   timerId = null
  }
  oscillators.forEach(osc => {
   try { osc.stop() } catch {}
  })
  oscillators = []
 },
 
 setVolume: (v: number) => {
  volume = Math.max(0, Math.min(1, v))
  if (masterGain) {
   masterGain.gain.value = volume
  }
 },
 
 isPlaying: () => isPlaying,
 getVolume: () => volume,
}
