import { t } from "./i18n";
import { motion } from "framer-motion";
import { useLivingScene } from "./useLivingScene";
import "./dome-habitat.css";

export function LivingPhobos(): JSX.Element {
  const { ref, active } = useLivingScene<HTMLDivElement>();
  return (
    <div ref={ref} className="living-phobos">
      <motion.div
        className="living-phobos-body"
        initial={false}
        animate={{
          x: active ? [-14, 23, 36, 4, -14] : 0,
          y: active ? [8, -7, 5, 15, 8] : 0,
          scale: active ? [0.97, 1.025, 1, 0.97] : 1,
        }}
        transition={{
          x: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
          y: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
          scale: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
        }}
      >
        <motion.img
          src="/ares/phobos.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ width: 140, height: 140, objectFit: "contain", display: "block", userSelect: "none" }}
          initial={false}
          animate={{ rotate: active ? [-8, 7, -8] : -4 }}
          transition={{
            duration: active ? 57 : 0,
            repeat: active ? Infinity : 0,
            ease: "easeInOut",
          }}
        />

        <div className="living-phobos-caption">
          <span className="living-phobos-dot" />
          {t("ФОБОС")}
          <small>{t("СПУТНИК МАРСА")}</small>
        </div>
      </motion.div>
    </div>
  );
}
