import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { AlertTriangle, Box, CheckCircle2, CircleDashed, Construction, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import { useGame } from '../contexts/GameContext'
import { BACKEND_URL, CLUSTER } from '../contexts/SolanaContext'
import { useI18n } from '../i18n'

type ResourceName = 'metal' | 'water' | 'power' | 'science'
type BuildingKind = 'solar_array' | 'water_recycler' | 'metal_extractor'
type ResearchId = 'resource_efficiency' | 'hydrology' | 'metallurgy' | 'solar_grid'
interface ColonyState {
  schemaVersion: 2
  rulesetVersion: number
  coreLevel: number
  labLevel: number
  resources: Record<ResourceName, number>
  capacities: Record<ResourceName, number>
  buildings: Array<{ id: string; kind: BuildingKind; level: number; status: 'constructing' | 'upgrading' | 'active'; targetLevel?: number; completesAt: string }>
  grants: { fieldSlots: number; labLevelCap: number; buildQueues: number; researchQueues: number; storageMultipliers: Record<ResourceName, number> }
  pendingResearch: Array<{ id: string; completesAt: string }>
  pendingLabUpgrade?: { targetLevel: number; completesAt: string } | null
  completedResearch: string[]
}
interface Snapshot {
  colonyId: string
  ownerWallet: string
  fieldAddress: string
  linkedFields: string[]
  rulesetVersion: number
  sequence: number
  stateHash: string
  state: ColonyState
  materializedAt: string
  pending: boolean
}
interface AuthResult { token: string; wallet: string; cluster: string; expiresInSeconds: number }
interface ColonyRules {
  version: number
  status: string
  freeStarterEnabled: boolean
  freeStarterLimit: string
  buildings: Record<BuildingKind, { cost: Record<ResourceName, number>; durationSeconds: number; production: Partial<Record<ResourceName, number>> }>
  labUpgrade: { cost: Record<ResourceName, number>; durationSeconds: number }
  research: Record<ResearchId, { cost: Record<ResourceName, number>; durationSeconds: number; productionBonusBps: number; prerequisites: ResearchId[]; productionBonusResource?: ResourceName }>
}
interface ApiError { error?: string }

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ApiError
  if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`)
  return body
}

/** Real server-backed Colony UI; no browser-owned resources, timers or fallback save. */
export default function PersistentColonyPanel(): JSX.Element {
  const { t } = useI18n()
  const wallet = useWallet()
  const game = useGame()
  const publicKey = wallet.publicKey
  const walletAddress = publicKey?.toBase58() ?? null
  const [token, setToken] = useState<string | null>(null)
  const [authWallet, setAuthWallet] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [rules, setRules] = useState<ColonyRules | null>(null)
  const [selectedField, setSelectedField] = useState<string>('')
  const [selectedLinkField, setSelectedLinkField] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const apiBase = `${BACKEND_URL}/api/colonies`
  const eligibleFields = useMemo(() => game.fields.filter(field => field.isActive && field.durability > 0), [game.fields])
  const linkableFields = useMemo(() => eligibleFields.filter(field => !snapshot?.linkedFields.includes(field.publicKey.toBase58())), [eligibleFields, snapshot?.linkedFields])

  useEffect(() => {
    if (!selectedField || !eligibleFields.some(field => field.publicKey.toBase58() === selectedField)) {
      setSelectedField(eligibleFields[0]?.publicKey.toBase58() ?? '')
    }
  }, [eligibleFields, selectedField])

  useEffect(() => {
    if (!selectedLinkField || !linkableFields.some(field => field.publicKey.toBase58() === selectedLinkField)) {
      setSelectedLinkField(linkableFields[0]?.publicKey.toBase58() ?? '')
    }
  }, [linkableFields, selectedLinkField])

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
    return readJson<T>(response)
  }, [apiBase, token])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const result = await api<{ snapshot: Snapshot }>('/state')
      setSnapshot(result.snapshot)
      setError(null)
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'UNKNOWN'
      if (code === 'COLONY_NOT_FOUND') setSnapshot(null)
      else setError(code)
    }
  }, [api, token])

  const loadRules = useCallback(async () => {
    if (!token) return
    try { setRules(await api<ColonyRules>('/rules')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'RULESET_UNAVAILABLE') }
  }, [api, token])

  useEffect(() => {
    if (!token || authWallet !== walletAddress) return
    void loadRules()
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(interval)
  }, [token, authWallet, walletAddress, refresh, loadRules])

  useEffect(() => {
    if (authWallet !== walletAddress) {
      setToken(null)
      setAuthWallet(null)
      setSnapshot(null)
    }
  }, [authWallet, walletAddress])

  const signIn = async () => {
    if (!publicKey || !wallet.signMessage) {
      setError(t('Этот кошелёк не поддерживает подпись сообщения.'))
      return
    }
    setBusy(true); setError(null); setNotice(null)
    try {
      const challenge = await api<{ challengeId: string; message: string; expiresAt: string }>('/auth/challenge', {
        method: 'POST', body: JSON.stringify({ wallet: publicKey.toBase58() }),
      })
      const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message))
      const session = await api<AuthResult>('/auth/verify', {
        method: 'POST', body: JSON.stringify({
          wallet: publicKey.toBase58(), challengeId: challenge.challengeId,
          message: challenge.message, signature: base64Url(signature),
        }),
      })
      if (session.cluster !== CLUSTER) throw new Error('CLUSTER_MISMATCH')
      setToken(session.token); setAuthWallet(session.wallet); setNotice(t('Кошелёк подтверждён. Состояние Colony хранится в backend.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AUTH_FAILED')
    } finally { setBusy(false) }
  }

  const initialize = async () => {
    if (!selectedField || !token) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await api<{ snapshot: Snapshot }>('/initialize', {
        method: 'POST', body: JSON.stringify({ fieldAddress: selectedField, requestId: crypto.randomUUID() }),
      })
      setSnapshot(result.snapshot)
      setNotice(t('Колония создана и сохранена на сервере.'))
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'INITIALIZATION_FAILED'
      setError(code)
      if (code === 'ENTITLEMENT_REQUIRED') setNotice(t('Для создания Colony требуется подтверждённый Starter entitlement. Продажи закрыты; оплату не отправляй.'))
    } finally { setBusy(false) }
  }

  const action = async (payload: { type: 'start_build'; building: BuildingKind } | { type: 'start_upgrade'; buildingId: string } | { type: 'start_lab_upgrade' } | { type: 'start_research'; research: ResearchId }) => {
    if (!snapshot) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await api<{ snapshot: Snapshot; duplicate: boolean }>('/actions', {
        method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), expectedSequence: snapshot.sequence, action: payload }),
      })
      setSnapshot(result.snapshot)
      setNotice(result.duplicate ? t('Это действие уже было сохранено.') : t('Действие сохранено сервером.'))
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'ACTION_FAILED'
      setError(code)
      if (code === 'VERSION_CONFLICT') await refresh()
    } finally { setBusy(false) }
  }

  const linkField = async () => {
    if (!snapshot || !selectedLinkField) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await api<{ snapshot: Snapshot; duplicate: boolean }>('/fields/link', {
        method: 'POST', body: JSON.stringify({ fieldAddress: selectedLinkField, requestId: crypto.randomUUID(), expectedSequence: snapshot.sequence }),
      })
      setSnapshot(result.snapshot)
      setNotice(result.duplicate ? t('Это Field уже было привязано.') : t('Поле проверено в Solana и связано с Colony. Это не изменяет добычу ресурсов.'))
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'FIELD_LINK_FAILED'
      setError(code)
      if (code === 'VERSION_CONFLICT') await refresh()
    } finally { setBusy(false) }
  }

  const unlinkField = async (fieldAddress: string) => {
    if (!snapshot) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await api<{ snapshot: Snapshot; duplicate: boolean }>('/fields/unlink', {
        method: 'POST', body: JSON.stringify({ fieldAddress, requestId: crypto.randomUUID(), expectedSequence: snapshot.sequence }),
      })
      setSnapshot(result.snapshot)
      setNotice(t('Действие сохранено сервером.'))
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'FIELD_UNLINK_FAILED'
      setError(code)
      if (code === 'VERSION_CONFLICT') await refresh()
    } finally { setBusy(false) }
  }

  const signOut = () => { setToken(null); setAuthWallet(null); setSnapshot(null); setNotice(t('Сессия кошелька завершена.')) }
  const resourceLabels: Record<ResourceName, string> = { metal: t('МЕТАЛЛ'), water: t('ВОДА'), power: t('ЭНЕРГИЯ'), science: t('ОЧКИ ИССЛЕДОВАНИЙ') }
  const buildingLabels: Record<BuildingKind, string> = { solar_array: t('СОЛНЕЧНЫЙ МАССИВ'), water_recycler: t('РЕЦИКЛЕР ВОДЫ'), metal_extractor: t('ДОБЫЧА МЕТАЛЛА') }
  const researchLabels: Record<ResearchId, string> = {
    resource_efficiency: t('ЭФФЕКТИВНОСТЬ РЕСУРСОВ'), hydrology: t('ГИДРОЛОГИЯ'),
    metallurgy: t('МЕТАЛЛУРГИЯ'), solar_grid: t('СОЛНЕЧНАЯ СЕТЬ'),
  }
  const formatCost = (cost: Record<ResourceName, number> | undefined) => cost
    ? (Object.keys(resourceLabels) as ResourceName[]).filter(key => cost[key] > 0).map(key => `${cost[key]} ${resourceLabels[key]}`).join(' · ')
    : 'Loading rules…'
  const scaleCost = (cost: Record<ResourceName, number>, factor: number): Record<ResourceName, number> => Object.fromEntries(
    (Object.keys(resourceLabels) as ResourceName[]).map(key => [key, cost[key] * factor]),
  ) as Record<ResourceName, number>
  const durationLabel = (seconds: number | undefined) => seconds === undefined ? '—' : `${Math.ceil(seconds / 3600)} h`
  const buildQueueFull = snapshot ? snapshot.state.buildings.filter(item => item.status === 'constructing' || item.status === 'upgrading').length + (snapshot.state.pendingLabUpgrade ? 1 : 0) >= snapshot.state.grants.buildQueues : true
  const rulesMatch = !!snapshot && !!rules && rules.version === snapshot.rulesetVersion
  const labUpgradeCost = snapshot && rules ? scaleCost(rules.labUpgrade.cost, snapshot.state.labLevel) : undefined
  const labUpgradeDuration = snapshot && rules ? rules.labUpgrade.durationSeconds * snapshot.state.labLevel : undefined

  return <section className="persistent-colony" data-testid="persistent-colony" aria-label={t('PERSISTENT COLONY')}>
    <header className="persistent-colony__header">
      <div><p className="persistent-colony__eyebrow">ARES—1 / BACKEND-PERSISTENT</p><h2>{t('КОЛОНИЯ · ПОСТОЯННОЕ СОХРАНЕНИЕ')}</h2><p>{t('Поле и токены подтверждаются Solana. Постройки, Lab и непередаваемые ресурсы хранятся в PostgreSQL и не являются on-chain.')}</p></div>
      <span className="persistent-colony__badge"><ShieldCheck size={15} />{t('СЕРВЕРНАЯ СЕССИЯ')}</span>
    </header>

    {!token ? <div className="persistent-colony__auth">
      <p><Wallet size={16} /> {t('Подпиши одноразовое сообщение для входа. Подпись не переводит токены и не отправляет транзакцию.')}</p>
      {wallet.connected && !wallet.signMessage && <p role="alert">{t('Этот кошелёк не поддерживает подпись сообщения.')}</p>}
      <button type="button" disabled={busy || !wallet.connected || !wallet.signMessage} onClick={() => void signIn()}>
        {busy ? t('ПРОВЕРЯЕМ…') : wallet.connected ? t('ВОЙТИ ЧЕРЕЗ ПОДПИСЬ КОШЕЛЬКА') : t('СНАЧАЛА ПОДКЛЮЧИ КОШЕЛЁК')}
      </button>
    </div> : <>
      <div className="persistent-colony__session"><span><CheckCircle2 size={15} />{authWallet?.slice(0, 5)}…{authWallet?.slice(-5)}</span><button type="button" onClick={signOut}>{t('ВЫЙТИ')}</button></div>
      {!snapshot ? <div className="persistent-colony__initialize">
        <label>{t('ВЫБЕРИ ПОДТВЕРЖДЁННОЕ АКТИВНОЕ ПОЛЕ')}
          <select value={selectedField} onChange={event => setSelectedField(event.target.value)} disabled={busy || eligibleFields.length === 0}>
            {eligibleFields.length === 0 && <option value="">{t('АКТИВНЫХ ПОЛЕЙ НЕТ')}</option>}
            {eligibleFields.map(field => <option key={field.publicKey.toBase58()} value={field.publicKey.toBase58()}>{field.publicKey.toBase58().slice(0, 7)}…{field.publicKey.toBase58().slice(-7)} · L{field.level}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !selectedField} onClick={() => void initialize()}><Construction size={15} />{rules?.freeStarterEnabled ? t('ПОЛУЧИТЬ БЕСПЛАТНЫЙ STARTER И СОЗДАТЬ COLONY') : t('ПРОВЕРИТЬ ENTITLEMENT И СОЗДАТЬ COLONY')}</button>
        <p>{rules?.freeStarterEnabled
          ? t('Бесплатный старт: одна Colony на кошелёк после проверки активного Field. Покупка и транзакция не нужны.')
          : t('Создание требует серверного Starter entitlement и finalized-проверки владельца Field. В этом окружении выдача пакетов и продажа выключены.')}</p>
      </div> : <>
        <div className="persistent-colony__summary">
          <div><span>{t('COLONY ID')}</span><strong>{snapshot.colonyId.slice(0, 8)}… · v{snapshot.sequence}</strong></div>
          <div><span>{t('ON-CHAIN FIELD')}</span><strong>{snapshot.fieldAddress.slice(0, 7)}…{snapshot.fieldAddress.slice(-7)}</strong></div>
          <div><span>{t('RULESET')}</span><strong>v{snapshot.rulesetVersion} · {t('ВНУТРЕННЯЯ ПРОВЕРКА')}</strong></div>
        </div>
        <div className="persistent-colony__initialize">
          <strong>{t('ПРИВЯЗАННЫЕ FIELD')} · {snapshot.linkedFields.length} / {snapshot.state.grants.fieldSlots}</strong>
          <p>{snapshot.linkedFields.map(field => `${field.slice(0, 7)}…${field.slice(-7)}${field === snapshot.fieldAddress ? ` · ${t('ОСНОВНОЕ')}` : ''}`).join(' · ')}</p>
          {snapshot.linkedFields.filter(field => field !== snapshot.fieldAddress).map(field => <button type="button" key={`unlink-${field}`} disabled={busy} onClick={() => void unlinkField(field)}>{t('ОТВЯЗАТЬ')} {field.slice(0, 7)}…{field.slice(-7)}</button>)}
          {linkableFields.length > 0 && snapshot.linkedFields.length < snapshot.state.grants.fieldSlots && <>
            <label>{t('ДОБАВИТЬ АКТИВНОЕ ПОЛЕ ИЗ КОШЕЛЬКА')}
              <select value={selectedLinkField} onChange={event => setSelectedLinkField(event.target.value)} disabled={busy}>
                {linkableFields.map(field => <option key={field.publicKey.toBase58()} value={field.publicKey.toBase58()}>{field.publicKey.toBase58().slice(0, 7)}…{field.publicKey.toBase58().slice(-7)} · L{field.level}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || !selectedLinkField} onClick={() => void linkField()}>{t('ПРОВЕРИТЬ И ПРИВЯЗАТЬ FIELD')}</button>
          </>}
          <p>{t('Сервер повторно проверяет finalized-владение. Field учитывается как слот; дополнительная добыча пока не включена.')}</p>
        </div>
        <div className="persistent-colony__resources">
          {(Object.keys(resourceLabels) as ResourceName[]).map(key => <div key={key}><span>{resourceLabels[key]}</span><strong>{snapshot.state.resources[key].toLocaleString()} / {snapshot.state.capacities[key].toLocaleString()}</strong></div>)}
        </div>
        <div className="persistent-colony__progress">
          <article><h3><Box size={15} /> CORE · L{snapshot.state.coreLevel}</h3><p>{t('ЦЕНТР КОЛОНИИ')}</p></article>
          <article><h3>LAB · L{snapshot.state.labLevel}</h3><p>{snapshot.state.completedResearch.length ? snapshot.state.completedResearch.join(', ') : t('ИССЛЕДОВАНИЙ ПОКА НЕТ')}</p>{snapshot.state.pendingLabUpgrade && <p>{t('УЛУЧШЕНИЕ ЛАБОРАТОРИИ')} → L{snapshot.state.pendingLabUpgrade.targetLevel} · {new Date(snapshot.state.pendingLabUpgrade.completesAt).toLocaleString()}</p>}<button type="button" disabled={busy || !rulesMatch || snapshot.state.pendingLabUpgrade != null || snapshot.state.labLevel >= snapshot.state.grants.labLevelCap || buildQueueFull} onClick={() => void action({ type: 'start_lab_upgrade' })}>{t('УЛУЧШИТЬ LAB')} · {formatCost(labUpgradeCost)} · {durationLabel(labUpgradeDuration)}</button></article>
          <article><h3><CircleDashed size={15} />{t('ОЧЕРЕДЬ')}</h3><p>{snapshot.state.pendingResearch.length ? snapshot.state.pendingResearch.map(job => `${job.id} · ${new Date(job.completesAt).toLocaleString()}`).join(' / ') : t('ИССЛЕДОВАНИЯ СВОБОДНЫ')}</p>{snapshot.state.buildings.filter(item => item.status === 'constructing' || item.status === 'upgrading').map(item => <p key={item.id}>{buildingLabels[item.kind]} L{item.level}{item.targetLevel ? ` → L${item.targetLevel}` : ''} · {new Date(item.completesAt).toLocaleString()}</p>)}</article>
        </div>
        <div className="persistent-colony__actions">
          <div><h3>{t('СТРОИТЕЛЬСТВО')}</h3>
            {(Object.keys(buildingLabels) as BuildingKind[]).map(kind => <button type="button" key={kind} disabled={busy || !rulesMatch || buildQueueFull || snapshot.state.buildings.some(item => item.kind === kind)} onClick={() => void action({ type: 'start_build', building: kind })}>{buildingLabels[kind]} · {formatCost(rules?.buildings[kind].cost)} · {durationLabel(rules?.buildings[kind].durationSeconds)}</button>)}
            {snapshot.state.buildings.map(building => building.status === 'active' && <button type="button" key={`upgrade-${building.id}`} disabled={busy || !rulesMatch || building.level >= 3 || buildQueueFull} onClick={() => void action({ type: 'start_upgrade', buildingId: building.id })}>{t('УЛУЧШИТЬ')} {buildingLabels[building.kind]} L{building.level} → L{building.level + 1} · {formatCost(rules ? scaleCost(rules.buildings[building.kind].cost, building.level) : undefined)} · {durationLabel(rules ? rules.buildings[building.kind].durationSeconds * building.level : undefined)}</button>)}
          </div>
          <div><h3>{t('ИССЛЕДОВАНИЯ')}</h3>
            {(Object.keys(researchLabels) as ResearchId[]).map(research => <button type="button" key={research} disabled={busy || !rules || !rulesMatch || snapshot.state.completedResearch.includes(research) || snapshot.state.pendingResearch.length >= snapshot.state.grants.researchQueues || snapshot.state.pendingResearch.some(job => job.id === research) || rules.research[research].prerequisites.some(required => !snapshot.state.completedResearch.includes(required))} onClick={() => void action({ type: 'start_research', research })}>{researchLabels[research]} · {formatCost(rules?.research[research].cost)} · {durationLabel(rules?.research[research].durationSeconds)}</button>)}
          </div>
          <button className="persistent-colony__refresh" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />{t('ОБНОВИТЬ ИЗ BACKEND')}</button>
        </div>
        <p className="persistent-colony__hash">{t('ПОСЛЕДНИЙ СОХРАНЁННЫЙ ХЭШ')}: <code>{snapshot.stateHash.slice(0, 20)}…</code> · {new Date(snapshot.materializedAt).toLocaleString()}</p>
      </>}
    </>}
    {notice && <p className="persistent-colony__notice" role="status">{notice}</p>}
    {error && <p className="persistent-colony__error" role="alert"><AlertTriangle size={15} />{error}</p>}
    <p className="persistent-colony__disclaimer">{t('Нет локального fallback: если backend недоступен, действия не выполняются. Ресурсы и прогресс здесь не являются on-chain.')}</p>
  </section>
}
