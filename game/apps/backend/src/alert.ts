// F-10: external alerting for the epoch roller (the only crank in prod).
// Pure decision/payload logic lives here so tests never touch the network.
//
// Wire-up: set ALERT_WEBHOOK_URL (Slack/Discord/ntfy/generic JSON sink).
// When unset, sendAlert() is a no-op — operators still see console errors;
// the webhook is an *additional* channel, never a replacement for logs.
//
// Network policy: tests inject a fake fetch; production calls are fire-and-
// forget with a 5 s cap and can never crash the roller.

export const ALERT_LADDER: readonly number[] = [3, 9, 27];

export function shouldAlert(consecutiveFailures: number): boolean {
  return ALERT_LADDER.includes(consecutiveFailures);
}

export interface AlertPayload {
  service: "ares1-backend";
  severity: "critical";
  event: string;
  message: string;
  consecutiveFailures?: number;
  at: string;
}

export function buildAlert(
  event: string,
  message: string,
  consecutiveFailures?: number,
  now: () => string = () => new Date().toISOString(),
): AlertPayload {
  return {
    service: "ares1-backend",
    severity: "critical",
    event,
    message,
    ...(consecutiveFailures === undefined ? {} : { consecutiveFailures }),
    at: now(),
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
}>;

/** POST JSON to the webhook. Returns true on 2xx; false on any failure.
 *  Never throws — alerting must not take down the process it alerts about. */
export async function sendAlert(
  webhookUrl: string,
  payload: AlertPayload,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
