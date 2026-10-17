/** Клиент POST /api/slots/grant. Ошибки сервера приходят кодом, без внутренних деталей. */
export interface SlotRecordView {
  v: number
  field_id: string
  slot: number
  wallet: string
  nonce: string
  issued_at: number
  expires_at: number
  payment_signature: string | null
  key_id: string
}

export interface GrantBody {
  field_id: string
  slot: number
  wallet: string
  payment_signature: string | null
  ts: number
  sig: string
}

export type GrantResult =
  | { ok: true; record: SlotRecordView; signature: string; reissued: boolean }
  | { ok: false; status: number; error: string }

export async function postSlotGrant(baseUrl: string, body: GrantBody, fetchImpl: typeof fetch = fetch): Promise<GrantResult> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/slots/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, error: 'NETWORK' }
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok && data.record && typeof data.signature === 'string') {
    return { ok: true, record: data.record as SlotRecordView, signature: data.signature, reissued: data.reissued === true }
  }
  return { ok: false, status: response.status, error: typeof data.error === 'string' ? data.error : 'INTERNAL' }
}
