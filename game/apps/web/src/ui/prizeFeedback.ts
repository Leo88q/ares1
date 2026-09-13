export type PrizeSoundName =
  | "prize.reveal.seal"
  | "prize.reveal.burst";

export interface PrizeSoundEvent {
  readonly name: PrizeSoundName;
  readonly volume: number;
}

export const prizeSoundEventName = "ares:prize-sound";

function requestSound(name: PrizeSoundName, volume: number): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PrizeSoundEvent>(prizeSoundEventName, {
      detail: { name, volume },
    }),
  );
}

export function playSealBreak(): void {
  requestSound("prize.reveal.seal", 0.65);
}

export function playPrizeBurst(): void {
  requestSound("prize.reveal.burst", 0.75);
}

export function vibratePrize(pattern: number | number[]): void {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function" ||
    document.hidden
  ) {
    return;
  }

  try {
    navigator.vibrate(pattern);
  } catch {
    // Haptics are optional and must never interrupt reward handling.
  }
}
