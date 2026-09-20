import { t } from "./i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import type { ReactNode } from "react";

export const xpThresholds = [
  0,
  50,
  150,
  300,
  500,
  800,
  1200,
  1700,
  2300,
  3000,
] as const;

const storageKey = "ares:gamification:v1";
const maximumXp = 1_000_000;
const maximumSeenKeys = 300;

export interface XpOrigin {
  readonly x: number;
  readonly y: number;
}

export type XpAction =
  | { readonly kind: "section"; readonly id: string }
  | { readonly kind: "mascot" }
  | { readonly kind: "faq"; readonly id: string }
  | { readonly kind: "feature"; readonly id: string }
  | { readonly kind: "waitlist" };

export interface XpFlight {
  readonly id: number;
  readonly amount: number;
  readonly label: string;
  readonly origin: XpOrigin;
}

export interface LevelReward {
  readonly id: number;
  readonly level: number;
}

interface SavedProgress {
  readonly version: 1;
  readonly xp: number;
  readonly seen: readonly string[];
  readonly streak: number;
  readonly lastDay: string;
  readonly colonistRank: boolean;
}

interface GamificationState extends SavedProgress {
  readonly serial: number;
  readonly flights: readonly XpFlight[];
  readonly levels: readonly LevelReward[];
  readonly lastReward: string;
}

interface RewardDefinition {
  readonly amount: number;
  readonly label: string;
  readonly key: string | null;
  readonly colonistRank: boolean;
}

type ReducerAction =
  | {
      readonly type: "award";
      readonly reward: RewardDefinition;
      readonly origin: XpOrigin;
      readonly day: string;
    }
  | { readonly type: "remove-flight"; readonly id: number }
  | { readonly type: "remove-level"; readonly id: number }
  | { readonly type: "visit"; readonly day: string };

interface GamificationContextValue {
  readonly xp: number;
  readonly level: number;
  readonly nextThreshold: number | null;
  readonly progress: number;
  readonly streak: number;
  readonly colonistRank: boolean;
  readonly lastReward: string;
  readonly flights: readonly XpFlight[];
  readonly levels: readonly LevelReward[];
  readonly award: (action: XpAction, origin?: XpOrigin) => void;
  readonly removeFlight: (id: number) => void;
  readonly removeLevel: (id: number) => void;
}

const GamificationContext =
  createContext<GamificationContextValue | null>(null);

function localDay(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function dayNumber(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return NaN;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }

  return timestamp / 86_400_000;
}

function streakFor(
  lastDay: string,
  currentDay: string,
  currentStreak: number,
): number {
  if (lastDay === currentDay) {
    return Math.max(1, currentStreak);
  }

  const difference = dayNumber(currentDay) - dayNumber(lastDay);

  return difference === 1
    ? Math.min(3650, Math.max(1, currentStreak) + 1)
    : 1;
}

export function levelForXp(xp: number): number {
  let level = 1;

  for (let index = 0; index < xpThresholds.length; index += 1) {
    const threshold = xpThresholds[index];

    if (threshold !== undefined && xp >= threshold) {
      level = index + 1;
    }
  }

  return level;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validSavedProgress(value: unknown): value is SavedProgress {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    typeof value.xp === "number" &&
    Number.isInteger(value.xp) &&
    value.xp >= 0 &&
    value.xp <= maximumXp &&
    Array.isArray(value.seen) &&
    value.seen.length <= maximumSeenKeys &&
    value.seen.every(
      (key: unknown) =>
        typeof key === "string" &&
        key.length <= 160 &&
        /^(section|faq|feature|waitlist):/.test(key),
    ) &&
    typeof value.streak === "number" &&
    Number.isInteger(value.streak) &&
    value.streak >= 1 &&
    value.streak <= 3650 &&
    typeof value.lastDay === "string" &&
    Number.isFinite(dayNumber(value.lastDay)) &&
    typeof value.colonistRank === "boolean"
  );
}

function initialState(): GamificationState {
  const today = localDay();

  const fallback: GamificationState = {
    version: 1,
    xp: 0,
    seen: [],
    streak: 1,
    lastDay: today,
    colonistRank: false,
    serial: 0,
    flights: [],
    levels: [],
    lastReward: t("Исследуй колонию"),
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);

    if (!raw) {
      return fallback;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!validSavedProgress(parsed)) {
      return fallback;
    }

    return {
      ...fallback,
      xp: parsed.xp,
      seen: [...new Set(parsed.seen)],
      streak: streakFor(parsed.lastDay, today, parsed.streak),
      lastDay: today,
      colonistRank: parsed.colonistRank,
      lastReward: t("Прогресс этой сессии восстановлен"),
    };
  } catch {
    return fallback;
  }
}

function rewardFor(action: XpAction): RewardDefinition | null {
  switch (action.kind) {
    case "section":
      return {
        amount: 10,
        label: t("Секция исследована"),
        key: `section:${action.id}`,
        colonistRank: false,
      };

    case "mascot":
      return {
        amount: 5,
        label: t("Прыжок ТЮБЕР-9"),
        key: null,
        colonistRank: false,
      };

    case "faq":
      return {
        amount: 2,
        label: t("Ответ колонии открыт"),
        key: `faq:${action.id}`,
        colonistRank: false,
      };

    case "feature": {
      const ids = ["harvest", "day-night", "marketplace", "referrals"];

      if (!ids.includes(action.id)) {
        return null;
      }

      return {
        amount: 1,
        label: t("Механика изучена"),
        key: `feature:${action.id}`,
        colonistRank: false,
      };
    }

    case "waitlist":
      return {
        amount: 100,
        label: t("Заявка принята · ранг колониста"),
        key: "waitlist:confirmed",
        colonistRank: true,
      };
  }
}

function reducer(
  state: GamificationState,
  action: ReducerAction,
): GamificationState {
  switch (action.type) {
    case "visit": {
      if (action.day === state.lastDay) {
        return state;
      }

      return {
        ...state,
        streak: streakFor(state.lastDay, action.day, state.streak),
        lastDay: action.day,
      };
    }

    case "remove-flight":
      return {
        ...state,
        flights: state.flights.filter((flight) => flight.id !== action.id),
      };

    case "remove-level":
      return {
        ...state,
        levels: state.levels.filter((level) => level.id !== action.id),
      };

    case "award": {
      if (action.reward.key && state.seen.includes(action.reward.key)) {
        return state;
      }

      const nextXp = Math.min(maximumXp, state.xp + action.reward.amount);
      const actualAmount = nextXp - state.xp;

      if (actualAmount <= 0) {
        return state;
      }

      const oldLevel = levelForXp(state.xp);
      const nextLevel = levelForXp(nextXp);
      const serial = state.serial + 1;

      const nextSeen = action.reward.key
        ? [...state.seen, action.reward.key].slice(-maximumSeenKeys)
        : state.seen;

      const levelRewards: LevelReward[] = [];

      if (nextLevel > oldLevel) {
        levelRewards.push({ id: serial, level: nextLevel });
      }

      return {
        ...state,
        xp: nextXp,
        serial,
        seen: nextSeen,
        streak: streakFor(state.lastDay, action.day, state.streak),
        lastDay: action.day,
        colonistRank: state.colonistRank || action.reward.colonistRank,
        lastReward: `+${actualAmount} XP · ${action.reward.label}`,
        flights: [
          ...state.flights.slice(-5),
          {
            id: serial,
            amount: actualAmount,
            label: action.reward.label,
            origin: action.origin,
          },
        ],
        levels: [...state.levels, ...levelRewards],
      };
    }
  }
}

export function GamificationProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    const saved: SavedProgress = {
      version: 1,
      xp: state.xp,
      seen: state.seen,
      streak: state.streak,
      lastDay: state.lastDay,
      colonistRank: state.colonistRank,
    };

    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // The experience remains usable when browser storage is unavailable.
    }
  }, [
    state.xp,
    state.seen,
    state.streak,
    state.lastDay,
    state.colonistRank,
  ]);

  useEffect(() => {
    function registerVisit(): void {
      if (!document.hidden) {
        dispatch({ type: "visit", day: localDay() });
      }
    }

    const interval = window.setInterval(registerVisit, 60_000);
    document.addEventListener("visibilitychange", registerVisit);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", registerVisit);
    };
  }, []);

  const award = useCallback(
    (action: XpAction, origin?: XpOrigin): void => {
      const reward = rewardFor(action);

      if (!reward) {
        return;
      }

      const defaultOrigin = {
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.55,
      };

      const selectedOrigin = origin ?? defaultOrigin;

      dispatch({
        type: "award",
        reward,
        day: localDay(),
        origin: {
          x: Number.isFinite(selectedOrigin.x)
            ? Math.max(0, Math.min(window.innerWidth, selectedOrigin.x))
            : defaultOrigin.x,
          y: Number.isFinite(selectedOrigin.y)
            ? Math.max(0, Math.min(window.innerHeight, selectedOrigin.y))
            : defaultOrigin.y,
        },
      });
    },
    [],
  );

  const removeFlight = useCallback((id: number): void => {
    dispatch({ type: "remove-flight", id });
  }, []);

  const removeLevel = useCallback((id: number): void => {
    dispatch({ type: "remove-level", id });
  }, []);

  const level = levelForXp(state.xp);
  const floor = xpThresholds[level - 1] ?? 0;
  const nextThreshold = xpThresholds[level] ?? null;

  const progress =
    nextThreshold === null
      ? 1
      : Math.max(0, Math.min(1, (state.xp - floor) / (nextThreshold - floor)));

  const value = useMemo<GamificationContextValue>(
    () => ({
      xp: state.xp,
      level,
      nextThreshold,
      progress,
      streak: state.streak,
      colonistRank: state.colonistRank,
      lastReward: state.lastReward,
      flights: state.flights,
      levels: state.levels,
      award,
      removeFlight,
      removeLevel,
    }),
    [
      state.xp,
      state.streak,
      state.colonistRank,
      state.lastReward,
      state.flights,
      state.levels,
      level,
      nextThreshold,
      progress,
      award,
      removeFlight,
      removeLevel,
    ],
  );

  return (
    <GamificationContext.Provider value={value}>
      {children}
    </GamificationContext.Provider>
  );
}

export function useGamification(): GamificationContextValue {
  const value = useContext(GamificationContext);

  if (!value) {
    throw new Error("useGamification requires GamificationProvider.");
  }

  return value;
}

export function elementXpOrigin(element: HTMLElement): XpOrigin {
  const bounds = element.getBoundingClientRect();

  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}
