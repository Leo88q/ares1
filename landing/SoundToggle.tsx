import { Volume2, VolumeX } from "lucide-react";
import { MotionIcon } from "./MicroMotion";
import { useSounds } from "./useSounds";
import "./sound-toggle.css";

export function SoundToggle(): JSX.Element {
  const {
    muted,
    reducedMotionMuted,
    setMuted,
  } = useSounds();

  const label = reducedMotionMuted
    ? "Звук отключён настройкой уменьшения движения"
    : muted
      ? "Включить звук"
      : "Выключить звук";

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-label={label}
      title={label}
      aria-pressed={!muted}
      aria-disabled={reducedMotionMuted || undefined}
      data-sound-ignore
      onClick={() => {
        if (!reducedMotionMuted) {
          setMuted(!muted);
        }
      }}
    >
      <MotionIcon active={!muted}>
        {muted ? (
          <VolumeX size={18} aria-hidden="true" />
        ) : (
          <Volume2 size={18} aria-hidden="true" />
        )}
      </MotionIcon>
    </button>
  );
}
