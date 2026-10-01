#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Зонды devnet для расчёта стоимости деплоя (измерительный контур rent-audit)
#
#  ТОЛЬКО ЧТЕНИЕ: ни ключей, ни транзакций, ни airdrop'а (R2). Всё, что
#  печатается в аннотации, — публичные данные: адреса, размеры, лампорты,
#  хэши, версии (R11).
#
#  Каждая проба печатает ровно одну аннотацию `ares-<ключ>`; недоступность
#  публичного RPC — не провал job'а, а `{"measured":false,"reason":…}`: тогда
#  цифры помечаются НЕ ИЗМЕРЕНО и в отчёте указывается причина.
#
#  Использование:
#    RPC_URL=<url> ./scripts/probe-devnet.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

CONFIG=scripts/rent-audit.config.json
RPC="${RPC_URL:-$(jq -r '.rpc' "$CONFIG")}"
PROGRAM_ID="${PROGRAM_ID:-$(jq -r '.programId' "$CONFIG")}"
DEPLOYER="${DEPLOYER:-$(jq -r '.deployer' "$CONFIG")}"
LEGACY="${LEGACY_PROGRAM_ID:-$(jq -r '.legacyProgramId // ""' "$CONFIG")}"

PROBE_ERRORS=0

# Аннотация: title + одна строка. Экранируем % \r \n по правилам GitHub.
# Пустое тело означает ошибку в jq-выражении (не «нет данных»): это провал job'а,
# иначе аннотация молча уедет пустой и её прочитают как отсутствие факта.
note() {
  local title="$1" body="$2"
  if [ -z "$body" ]; then
    printf '::error title=%s::пустая аннотация — ошибка формирования JSON (jq-выражение)\n' "$title"
    PROBE_ERRORS=$((PROBE_ERRORS + 1))
    return 0
  fi
  printf '::notice title=%s::%s\n' "$title" "$(printf '%s' "$body" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | tr -d '\n')"
}

# Аннотация «не измерено» с причиной (причина — публичный текст ошибки, обрезаем).
unmeasured() {
  local title="$1" reason="$2"
  note "$title" "$(jq -cn --arg r "${reason:0:500}" '{measured:false,reason:$r}')"
}

rpc() {
  curl -sS -m 45 -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC"
}

echo "RPC=$RPC PROGRAM_ID=$PROGRAM_ID DEPLOYER=$DEPLOYER"

# ── ares-rate: ставка rent, эпоха, версия кластера ───────────────────────────
RENT0_RESP=$(rpc getMinimumBalanceForRentExemption '[0]' || true)
RENT0=$(jq -r '.result // empty' <<<"$RENT0_RESP" 2>/dev/null)
if [ -z "$RENT0" ]; then
  # Публичный RPC может отказать: это НЕ ИЗМЕРЕНО, а не провал job'а (иначе
  # зелёность CI зависела бы от чужого rate-limit'а). Причину видно в аннотации.
  unmeasured ares-rate "getMinimumBalanceForRentExemption(0): $(printf '%s' "$RENT0_RESP" | head -c 300)"
  RATE=""
else
  RATE=$((RENT0 / 128))
  if [ $((RATE * 128)) -ne "$RENT0" ]; then
    printf '::error title=ares-rate::rent(0)=%s не делится нацело на 128 — модель §5 неприменима\n' "$RENT0"
    exit 1
  fi
  RENT1=$(rpc getMinimumBalanceForRentExemption '[1]' | jq -r '.result // empty')
  # rent(1)-rent(0) обязан равняться ставке; если RPC не ответил на второй вызов,
  # подставляем rent(0) — тогда rateMatchesDelta=false, то есть «не подтверждено».
  RENT1="${RENT1:-$RENT0}"
  # Agave 4.3 отдаёт slotIndex/slotsInEpoch (поля `slot` в ответе больше нет).
  EPOCH=$(rpc getEpochInfo '[]' | jq -c '.result | {epoch,slotIndex,slotsInEpoch,absoluteSlot,blockHeight}' 2>/dev/null)
  VERSION=$(rpc getVersion '[]' | jq -r '.result["solana-core"] // "unknown"')
  GENESIS=$(rpc getGenesisHash '[]' | jq -r '.result // "unknown"')
  note ares-rate "$(jq -cn \
    --argjson rent0 "$RENT0" --argjson rate "$RATE" \
    --argjson rent1 "$RENT1" --argjson epoch "${EPOCH:-null}" \
    --arg version "$VERSION" --arg genesis "$GENESIS" \
    '{rent0:$rent0,rate:$rate,rent1:$rent1,rateMatchesDelta:(($rent1 - $rent0) == $rate),epoch:$epoch,version:$version,genesisHash:$genesis}')"
fi

# ── ares-program: состояние ProgramData текущей программы ────────────────────
# Читаем чисто через RPC: `solana program show` требует настроенного signer'а
# («No default signer found») даже для чтения, а ключей в этом контуре нет (R2).
# Раскладка UpgradeableLoaderState (loader-v3):
#   Program:     [u32 tag=2][32B programdata address]
#   ProgramData: [u32 tag=3][u64 slot][u8 opt][32B authority] — 45 байт заголовка.
PROG_RESP=$(rpc getAccountInfo "[\"$PROGRAM_ID\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":36}}]" || true)
if ! jq -e '.result.value.data[0]' >/dev/null 2>&1 <<<"$PROG_RESP"; then
  unmeasured ares-program "getAccountInfo(program): $(printf '%s' "$PROG_RESP" | head -c 300)"
else
  PROG_DATA=$(jq -r '.result.value.data[0]' <<<"$PROG_RESP")
  PROG_OWNER=$(jq -r '.result.value.owner' <<<"$PROG_RESP")
  PDA_B58=$(python3 -c '
import base64, sys
A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
raw = base64.b64decode(sys.argv[1])
if len(raw) != 36 or raw[:4] != b"\x02\x00\x00\x00":
    raise SystemExit(1)
b = raw[4:]
n = int.from_bytes(b, "big"); s = ""
while n:
    n, r = divmod(n, 58); s = A[r] + s
print("1" * (len(b) - len(b.lstrip(b"\x00"))) + s or "1")
' "$PROG_DATA" 2>/dev/null) || PDA_B58=""
  if [ -z "$PDA_B58" ]; then
    unmeasured ares-program "Program-аккаунт не декодирован (owner=$PROG_OWNER)"
  else
    PD_RESP=$(rpc getAccountInfo "[\"$PDA_B58\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":45}}]" || true)
    PD_JSON=$(python3 - "$PROG_DATA" "$PDA_B58" "$PROG_OWNER" \
      "$(jq -r '.result.value.data[0] // empty' <<<"$PD_RESP")" \
      "$(jq -r '.result.value.space // empty' <<<"$PD_RESP")" \
      "$(jq -r '.result.value.lamports // empty' <<<"$PD_RESP")" \
      "${RATE:-0}" <<'PY' 2>/dev/null
import base64, json, sys

A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = A[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\x00"))) + s or "1"


_, prog_b64, pda, owner, pd_b64, pd_space, pd_lamports, rate = sys.argv
prog_raw = base64.b64decode(prog_b64)
out = {"programDataAddress": pda, "programOwner": owner}
if not pd_b64:
    out["measured"] = False
    out["reason"] = "getAccountInfo(programData) не вернул data"
    print(json.dumps(out, separators=(",", ":")))
    raise SystemExit(0)
pd_raw = base64.b64decode(pd_b64)
if pd_raw[:4] != b"\x03\x00\x00\x00":
    out["measured"] = False
    out["reason"] = "ProgramData tag != 3"
    print(json.dumps(out, separators=(",", ":")))
    raise SystemExit(0)
has_authority = len(pd_raw) > 12 and pd_raw[12] == 1
header = 45 if has_authority else 13
out["measured"] = True
out["slot"] = int.from_bytes(pd_raw[4:12], "little")
out["authority"] = b58(pd_raw[13:45]) if has_authority else None
out["space"] = int(pd_space) if pd_space else None
out["dataLen"] = int(pd_space) - header if pd_space else None
out["lamports"] = int(pd_lamports) if pd_lamports else None
rate = int(rate)
if out["dataLen"] is not None and rate:
    out["rate"] = rate
    out["requiredLamports"] = (128 + 45 + out["dataLen"]) * rate
    out["excessLamports"] = out["lamports"] - out["requiredLamports"]
print(json.dumps(out, separators=(",", ":")))
PY
) || PD_JSON=""
    note ares-program "$PD_JSON"
  fi
fi

# ── ares-deployer: баланс деплоера ───────────────────────────────────────────
BAL_OUT=$(solana balance "$DEPLOYER" --lamports --url "$RPC" 2>&1) || true
BAL=$(awk '{print $1}' <<<"$BAL_OUT")
if [[ "$BAL" =~ ^[0-9]+$ ]]; then
  note ares-deployer "$(jq -cn --arg address "$DEPLOYER" --argjson lamports "$BAL" \
    '{address:$address,lamports:$lamports,sol:(($lamports/1000000000)|tostring)}')"
else
  unmeasured ares-deployer "solana balance: $(printf '%s' "$BAL_OUT" | head -c 300)"
fi

# ── ares-buffers: застрявшие буферы деплоера ────────────────────────────────
SHOW_HELP=$(solana program show --help 2>&1 || true)
if grep -q -- '--buffer-authority' <<<"$SHOW_HELP"; then
  BUF_OUT=$(solana program show --buffers --buffer-authority "$DEPLOYER" --lamports --url "$RPC" --output json 2>&1) || true
  if jq -e '.' >/dev/null 2>&1 <<<"$BUF_OUT"; then
    note ares-buffers "$(jq -cn --argjson raw "$(jq -c . <<<"$BUF_OUT")" '
      (if ($raw|type)=="array" then $raw else ($raw.buffers // $raw.accounts // []) end) as $list |
      {measured:true,count:($list|length),
       lamports:([$list[]? | (.lamports // 0)] | add // 0),
       buffers:[$list[]? | {address:(.address // .pubkey // .buffer),lamports:(.lamports // null)}]}')"
  else
    unmeasured ares-buffers "solana program show --buffers: $(printf '%s' "$BUF_OUT" | head -c 300)"
  fi
else
  # Фолбэк: getProgramAccounts к loader-v3 по memcmp authority (offset 5) с
  # dataSlice 5 байт — это теги Buffer(Enum=1) + Some(authority).
  LOADER=BPFLoaderUpgradeab1e11111111111111111111111
  BUF_RESP=$(rpc getProgramAccounts "[\"$LOADER\",{\"filters\":[{\"memcmp\":{\"offset\":5,\"bytes\":\"$DEPLOYER\"}}],\"dataSlice\":{\"offset\":0,\"length\":5},\"encoding\":\"base64\"}]" || true)
  if jq -e '.result | type=="array"' >/dev/null 2>&1 <<<"$BUF_RESP"; then
    note ares-buffers "$(jq -cn --argjson raw "$(jq -c '.result' <<<"$BUF_RESP")" '
      {measured:true,count:($raw|length),
       lamports:([$raw[]?.account.lamports] | add // 0),
       buffers:[$raw[]? | {address:.pubkey,lamports:.account.lamports,
                           tag:(.account.data[0])}],
       tagNote:"data[0] обязан быть [1,0,0,0,1]: Enum=Buffer, authority=Some"}')"
  else
    unmeasured ares-buffers "getProgramAccounts(loader-v3, memcmp offset 5): $(printf '%s' "$BUF_RESP" | head -c 300)"
  fi
fi

# ── ares-legacy: старая программа 48D2… (адрес — вопрос Q1) ─────────────────
if [ -z "$LEGACY" ]; then
  unmeasured ares-legacy "legacyProgramId не задан в scripts/rent-audit.config.json (вопрос Q1: полного адреса 48D2… в репозитории нет)"
else
  LEGACY_OUT=$(solana program show "$LEGACY" --url "$RPC" --output json 2>&1) || true
  if jq -e '.programId' >/dev/null 2>&1 <<<"$LEGACY_OUT"; then
    note ares-legacy "$(jq -cn --argjson raw "$(jq -c . <<<"$LEGACY_OUT")" '
      {measured:true, programId:($raw.programId // $raw.program_id),
       programDataAddress:($raw.programDataAddress // $raw.program_data_address),
       authority:($raw.authority // $raw.upgradeAuthority),
       lastDeploySlot:($raw.lastDeployedInSlot // $raw.lastDeploySlot),
       dataLen:($raw.dataLen // $raw.data_len), lamports:$raw.lamports}')"
  else
    unmeasured ares-legacy "solana program show $LEGACY: $(printf '%s' "$LEGACY_OUT" | head -c 300)"
  fi
fi

# ── ares-accounts: аккаунты игры по размерам (текущие / легаси) ─────────────
# 260/145/70/49 — текущие раскладки; 156/164/228/97/69/41 — легаси из
# game/docs/MIGRATIONS.md. Размер 49 делят Epoch, ExportLicense, MarketStats,
# SellerProfile — печатаем счётчик без разбивки по типам.
count_size() {
  local size="$1" resp attempt
  for attempt in 1 2 3; do
    resp=$(rpc getProgramAccounts "[\"$PROGRAM_ID\",{\"filters\":[{\"dataSize\":$size}],\"dataSlice\":{\"offset\":0,\"length\":0},\"encoding\":\"base64\"}]" || true)
    if jq -e '.result | type=="array"' >/dev/null 2>&1 <<<"$resp"; then
      jq -r '.result | length' <<<"$resp"
      return 0
    fi
    sleep 3
  done
  printf 'null'
}
CURRENT=$(jq -cn --argjson a "$(count_size 260)" --argjson b "$(count_size 145)" \
                   --argjson c "$(count_size 70)"  --argjson d "$(count_size 49)" \
                   '{config260:$a,adminState145:$b,field70:$c,shared49:$d}')
LEGACY_COUNTS=$(jq -cn --argjson a "$(count_size 156)" --argjson b "$(count_size 164)" \
                       --argjson c "$(count_size 228)" --argjson d "$(count_size 97)" \
                       --argjson e "$(count_size 69)"  --argjson f "$(count_size 41)" \
                       '{config156:$a,config164:$b,config228:$c,adminState97:$d,field69:$e,epoch41:$f}')
note ares-accounts "$(jq -cn --argjson current "$CURRENT" --argjson legacy "$LEGACY_COUNTS" \
  --arg note "null = публичный RPC отказал по этому размеру (НЕ ИЗМЕРЕНО); 0 = измерено, аккаунтов нет" \
  '{current:$current,legacy:$legacy,note:$note}')"

echo "probe-devnet: завершено"
if [ "$PROBE_ERRORS" -ne 0 ]; then
  echo "probe-devnet: $PROBE_ERRORS аннотаций не сформированы" >&2
  exit 1
fi
