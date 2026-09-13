import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useInView } from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";

export interface LivingScene<T extends HTMLElement> {
  readonly ref: RefObject<T>;
  readonly active: boolean;
  readonly reducedMotion: boolean;
}

export function useLivingScene<
  T extends HTMLElement = HTMLDivElement,
>(): LivingScene<T> {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();
  const inView = useInView(ref, { amount: 0 });

  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    function update(): void {
      setPageVisible(!document.hidden);
    }

    update();
    document.addEventListener("visibilitychange", update);

    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return {
    ref,
    active: inView && pageVisible && !reducedMotion,
    reducedMotion,
  };
}
