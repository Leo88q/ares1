import type { PublicKey } from "@solana/web3.js";

/** Fail closed: the online epoch payer must not hold any game admin role. */
export function assertDedicatedPayer(payer: PublicKey, config: {
  authority: PublicKey; pendingAuthority: PublicKey; rewardSigner: PublicKey;
}): void {
  if ([config.authority, config.pendingAuthority, config.rewardSigner].some(key => key.equals(payer))) {
    throw new Error("Epoch payer must be separate from authority, pending authority and reward signer");
  }
}

/** RPC exceptions often include the full credential-bearing endpoint. */
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, "[REDACTED_URL]")
    .replace(/((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s&,;]+/gi, "$1[REDACTED]")
    .replace(/\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/g, "[REDACTED_KEYPAIR]")
    .slice(0, 1000);
}
