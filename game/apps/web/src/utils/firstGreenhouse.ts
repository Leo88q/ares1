import { MICRO } from './constants'

export const FIRST_GREENHOUSE_CYCLE_DAYS = 28
export const FIRST_GREENHOUSE_CHAPTER_LENGTH_DAYS = 7
export const FIRST_GREENHOUSE_RATION_TARGET_MICRO = 100 * MICRO

export interface GreenhouseFieldSnapshot {
  readonly isActive: boolean
  readonly level: number
  readonly durability: number
  readonly mutationType: number
  readonly fertilizerUntil: number
}

export interface GreenhouseSnapshot {
  readonly fields: readonly GreenhouseFieldSnapshot[]
  /** Raw six-decimal token atoms read from the connected wallet's POTATO ATA. */
  readonly potatoBalanceMicro: number
  readonly nowSec: number
}

export interface GreenhouseMissionProgress {
  readonly id: 'first-field' | 'three-fields' | 'upgrade-level-five' | 'mutation' | 'ration-reserve' | 'active-fertilizer'
  readonly progress: number
  readonly target: number
  readonly complete: boolean
}

/**
 * Builds a truthful, read-only personal operation board from current on-chain
 * account snapshots. It deliberately does not mint points/rewards or persist a
 * claim: a later seasonal contract/indexer can replace this adapter without
 * changing the mission catalogue or its non-financial presentation.
 */
export function buildGreenhouseMissionProgress(snapshot: GreenhouseSnapshot): GreenhouseMissionProgress[] {
  const activeFields = snapshot.fields.filter((field) => field.isActive)
  const mutatedFields = activeFields.filter((field) => field.mutationType > 0).length
  const levelFiveFields = activeFields.filter((field) => field.level >= 5).length
  const fertilizedFields = activeFields.filter((field) => field.fertilizerUntil > snapshot.nowSec).length

  const rows: Array<Omit<GreenhouseMissionProgress, 'complete'>> = [
    { id: 'first-field', progress: Math.min(activeFields.length, 1), target: 1 },
    { id: 'three-fields', progress: Math.min(activeFields.length, 3), target: 3 },
    { id: 'upgrade-level-five', progress: Math.min(levelFiveFields, 1), target: 1 },
    { id: 'mutation', progress: Math.min(mutatedFields, 1), target: 1 },
    {
      id: 'ration-reserve',
      progress: Math.min(Math.max(0, snapshot.potatoBalanceMicro), FIRST_GREENHOUSE_RATION_TARGET_MICRO),
      target: FIRST_GREENHOUSE_RATION_TARGET_MICRO,
    },
    { id: 'active-fertilizer', progress: Math.min(fertilizedFields, 1), target: 1 },
  ]

  return rows.map((row) => ({ ...row, complete: row.progress >= row.target }))
}

export function greenhouseCycleEpoch(epochId: bigint | null | undefined): number | null {
  if (epochId === null || epochId === undefined || epochId < 0n) return null
  return Number(epochId % BigInt(FIRST_GREENHOUSE_CYCLE_DAYS)) + 1
}

export function greenhouseCycleNumber(epochId: bigint | null | undefined): number | null {
  if (epochId === null || epochId === undefined || epochId < 0n) return null
  return Number(epochId / BigInt(FIRST_GREENHOUSE_CYCLE_DAYS)) + 1
}

export function greenhouseChapterIndex(epochPosition: number | null): number | null {
  if (epochPosition === null || !Number.isInteger(epochPosition) || epochPosition < 1 || epochPosition > FIRST_GREENHOUSE_CYCLE_DAYS) return null
  return Math.floor((epochPosition - 1) / FIRST_GREENHOUSE_CHAPTER_LENGTH_DAYS)
}
