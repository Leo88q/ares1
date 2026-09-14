import {
  useEffect,
  useSyncExternalStore,
} from "react";
import { usePrefersReducedMotion } from "./hooks";
import {
  prizeSoundEventName,
} from "./prizeFeedback";
import type {
  PrizeSoundEvent,
} from "./prizeFeedback";

export type SoundName =
  | "ui.hover"
  | "ui.click"
  | "ui.success"
  | "ui.error"
  | "prize.reveal.seal"
  | "prize.reveal.burst"
  | "level.up"
  | "mascot.jump"
  | "interstellar.bridge";

export type SoundSources = Partial<Record<SoundName, string>>;

export interface SoundsApi {
  readonly muted: boolean;
  readonly reducedMotionMuted: boolean;
  readonly play: (name: SoundName, volume?: number) => void;
  readonly setMuted: (muted: boolean) => void;
}

interface CachedLoad {
  readonly controller: AbortController;
  readonly promise: Promise<AudioBuffer | null>;
}

const soundNames: readonly SoundName[] = [
  "ui.hover",
  "ui.click",
  "ui.success",
  "ui.error",
  "prize.reveal.seal",
  "prize.reveal.burst",
  "level.up",
  "mascot.jump",
  "interstellar.bridge",
];

const cooldowns: Record<SoundName, number> = {
  "ui.hover": 100,
  "ui.click": 65,
  "ui.success": 500,
  "ui.error": 350,
  "prize.reveal.seal": 250,
  "prize.reveal.burst": 250,
  "level.up": 700,
  "mascot.jump": 180,
  "interstellar.bridge": 700,
};

const listeners = new Set<() => void>();
const buffers = new Map<string, AudioBuffer>();
const loads = new Map<string, CachedLoad>();
const activeNodes = new Map<AudioBufferSourceNode, GainNode>();
const lastPlayed = new Map<SoundName, number>();

let userMuted = true;
let audioContext: AudioContext | null = null;
let sources: SoundSources = {};
let generation = 0;
let mountedHosts = 0;

function clampVolume(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.55;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function canPlay(): boolean {
  return (
    typeof document !== "undefined" &&
    !document.hidden &&
    !userMuted &&
    !prefersReducedMotion()
  );
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function getMutedSnapshot(): boolean {
  return userMuted;
}

function getServerSnapshot(): boolean {
  return true;
}

function disconnectNode(
  node: AudioBufferSourceNode,
  gain: GainNode,
): void {
  node.onended = null;

  try {
    node.stop();
  } catch {
    // A node may already have ended.
  }

  node.disconnect();
  gain.disconnect();
  activeNodes.delete(node);
}

function stopActiveSounds(): void {
  for (const [node, gain] of activeNodes) {
    disconnectNode(node, gain);
  }
}

function cancelLoads(): void {
  for (const load of loads.values()) {
    load.controller.abort();
  }

  loads.clear();
}

function cancelHaptics(): void {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
    try {
      navigator.vibrate(0);
    } catch {
      // Haptics are optional.
    }
  }
}

function pauseSounds(): void {
  generation += 1;
  stopActiveSounds();
  cancelHaptics();

  const context = audioContext;

  if (context && context.state === "running") {
    void context.suspend().catch(() => undefined);
  }
}

function unlockAudio(): void {
  if (typeof window === "undefined" || !canPlay()) {
    return;
  }

  try {
    if (!audioContext || audioContext.state === "closed") {
      if (typeof window.AudioContext !== "function") {
        return;
      }

      audioContext = new window.AudioContext({
        latencyHint: "interactive",
      });
    }

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }
  } catch {
    // Unsupported or blocked audio never interrupts the interface.
  }
}

function setMuted(muted: boolean): void {
  userMuted = muted;

  if (muted || prefersReducedMotion()) {
    pauseSounds();
  } else {
    unlockAudio();
  }

  emitChange();
}

function normalizeSource(value: string): string | null {
  try {
    const url = new URL(value, window.location.href);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      (window.location.protocol === "https:" && url.protocol !== "https:")
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Configure real audio files when they become available.
 * No network request is made until play() requests a configured sound.
 */
export function configureSoundSources(next: SoundSources): void {
  generation += 1;
  stopActiveSounds();
  cancelLoads();
  buffers.clear();
  sources = { ...next };
}

async function loadBuffer(
  url: string,
  context: AudioContext,
): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);

  if (cached) {
    return cached;
  }

  const existing = loads.get(url);

  if (existing) {
    return existing.promise;
  }

  const controller = new AbortController();

  const promise = (async (): Promise<AudioBuffer | null> => {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "same-origin",
      });

      if (!response.ok) {
        return null;
      }

      const bytes = await response.arrayBuffer();

      if (controller.signal.aborted) {
        return null;
      }

      const buffer = await context.decodeAudioData(bytes);

      if (!controller.signal.aborted && audioContext === context) {
        buffers.set(url, buffer);
        return buffer;
      }

      return null;
    } catch {
      return null;
    } finally {
      if (loads.get(url)?.controller === controller) {
        loads.delete(url);
      }
    }
  })();

  loads.set(url, { controller, promise });

  return promise;
}

function vibrateForSound(name: SoundName): void {
  if (
    !canPlay() ||
    typeof navigator.vibrate !== "function"
  ) {
    return;
  }

  // Prize Reveal already owns its haptic sequence.
  // Generic clicks stay silent haptically to avoid double feedback.
  const pattern: number | number[] | null =
    name === "ui.success"
      ? [12, 30, 20]
      : name === "ui.error"
        ? [18, 35, 18]
        : name === "mascot.jump"
          ? 10
          : null;

  if (pattern === null) {
    return;
  }

  try {
    navigator.vibrate(pattern);
  } catch {
    // Unsupported haptics are ignored.
  }
}

function play(name: SoundName, volume = 0.55): void {
  if (!canPlay()) {
    return;
  }

  const now = performance.now();
  const previous = lastPlayed.get(name) ?? -Infinity;

  if (now - previous < cooldowns[name]) {
    return;
  }

  lastPlayed.set(name, now);

  const safeVolume = clampVolume(volume);

  if (safeVolume === 0) {
    return;
  }

  vibrateForSound(name);

  const source = sources[name];

  if (!source) {
    if (import.meta.env.DEV) {
      console.debug("[ARES audio placeholder]", name, safeVolume);
    }

    return;
  }

  const url = normalizeSource(source);
  const context = audioContext;

  if (!url || !context || context.state !== "running") {
    return;
  }

  const requestedAt = now;
  const requestedGeneration = generation;

  void loadBuffer(url, context).then((buffer) => {
    if (
      !buffer ||
      requestedGeneration !== generation ||
      !canPlay() ||
      audioContext !== context ||
      context.state !== "running" ||
      performance.now() - requestedAt > 600
    ) {
      return;
    }

    if (activeNodes.size >= 6) {
      const oldest = activeNodes.entries().next();

      if (!oldest.done) {
        disconnectNode(oldest.value[0], oldest.value[1]);
      }
    }

    const node = context.createBufferSource();
    const gain = context.createGain();

    node.buffer = buffer;
    gain.gain.value = safeVolume * 0.65;

    node.connect(gain);
    gain.connect(context.destination);
    activeNodes.set(node, gain);

    node.onended = () => {
      node.disconnect();
      gain.disconnect();
      activeNodes.delete(node);
    };

    try {
      node.start();
    } catch {
      disconnectNode(node, gain);
    }
  });
}

function disposeAudio(): void {
  generation += 1;
  stopActiveSounds();
  cancelLoads();
  buffers.clear();
  lastPlayed.clear();
  cancelHaptics();

  const context = audioContext;
  audioContext = null;

  if (context && context.state !== "closed") {
    void context.close().catch(() => undefined);
  }
}

export function useSounds(): SoundsApi {
  const muted = useSyncExternalStore(
    subscribe,
    getMutedSnapshot,
    getServerSnapshot,
  );

  const reducedMotionMuted = usePrefersReducedMotion();

  return {
    muted: muted || reducedMotionMuted,
    reducedMotionMuted,
    play,
    setMuted,
  };
}

function findInteractive(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const element = target.closest<HTMLElement>(
    "button, a[href], [role='button']",
  );

  if (
    !element ||
    element.closest("[data-sound-ignore]") ||
    element.matches(":disabled, [aria-disabled='true']")
  ) {
    return null;
  }

  return element;
}

function isPrizeEvent(
  event: Event,
): event is CustomEvent<PrizeSoundEvent> {
  if (!(event instanceof CustomEvent)) {
    return false;
  }

  const detail: unknown = event.detail;

  if (typeof detail !== "object" || detail === null) {
    return false;
  }

  if (!("name" in detail) || !("volume" in detail)) {
    return false;
  }

  return (
    (detail.name === "prize.reveal.seal" ||
      detail.name === "prize.reveal.burst") &&
    typeof detail.volume === "number" &&
    Number.isFinite(detail.volume)
  );
}

/**
 * Mount once per application.
 * Delegation covers existing native buttons and links without JSX replacement.
 */
export function SoundEvents(): null {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      pauseSounds();
    }
  }, [reducedMotion]);

  useEffect(() => {
    mountedHosts += 1;

    if (mountedHosts > 1) {
      return () => {
        mountedHosts -= 1;
      };
    }

    function handlePointerOver(event: PointerEvent): void {
      if (event.pointerType !== "mouse") {
        return;
      }

      const element = findInteractive(event.target);

      if (
        !element ||
        (event.relatedTarget instanceof Node &&
          element.contains(event.relatedTarget))
      ) {
        return;
      }

      play("ui.hover", 0.16);
    }

    function handleClick(event: MouseEvent): void {
      if (!findInteractive(event.target)) {
        return;
      }

      play("ui.click", 0.35);
    }

    function handleFocus(event: FocusEvent): void {
      const element = findInteractive(event.target);

      if (element?.matches(":focus-visible")) {
        play("ui.hover", 0.16);
      }
    }

    function handleUnlock(): void {
      unlockAudio();
    }

    function handlePrize(event: Event): void {
      if (isPrizeEvent(event)) {
        play(event.detail.name, event.detail.volume);
      }
    }

    function handleVisibility(): void {
      if (document.hidden) {
        pauseSounds();
      }

      // Resuming requires the next user interaction.
    }

    document.addEventListener("pointerover", handlePointerOver, {
      passive: true,
    });
    document.addEventListener("click", handleClick);
    document.addEventListener("focusin", handleFocus);
    document.addEventListener("pointerdown", handleUnlock, {
      passive: true,
    });
    document.addEventListener("keydown", handleUnlock);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(prizeSoundEventName, handlePrize);

    return () => {
      mountedHosts -= 1;

      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("pointerdown", handleUnlock);
      document.removeEventListener("keydown", handleUnlock);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(prizeSoundEventName, handlePrize);

      if (mountedHosts === 0) {
        disposeAudio();
      }
    };
  }, []);

  return null;
}

export function isSoundName(value: string): value is SoundName {
  return soundNames.some((name) => name === value);
}
