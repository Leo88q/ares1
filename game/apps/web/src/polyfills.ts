import { Buffer } from 'buffer'

declare global {
 interface Window {
  Buffer: typeof Buffer
  global: Window
  webkitAudioContext?: typeof AudioContext
 }
}

// @solana/web3.js and spl-token expect Node-style globals in the browser.
window.Buffer = window.Buffer ?? Buffer
window.global = window.global ?? window
