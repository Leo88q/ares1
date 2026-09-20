import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { GamificationProvider } from "./Gamification";
import {
  configureSoundSources,
  SoundEvents,
} from "./useSounds";
import { soundSources } from "./soundSources";
import { usePrefersReducedMotion, useSmoothScroll } from "./hooks";
import "./index.css";
import "./i18n/dicts";


configureSoundSources(soundSources);

function Root(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();

  useSmoothScroll();

  return (
    <MotionConfig
      reducedMotion="user"
      transition={
        reducedMotion
          ? { duration: 0.15 }
          : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }
      }
    >
      <GamificationProvider>
        <SoundEvents />
        <App />
      </GamificationProvider>
    </MotionConfig>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error('Required element "#root" was not found.');
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
