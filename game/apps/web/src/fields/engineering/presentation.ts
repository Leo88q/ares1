import type { FieldVisual } from '../model'
import { LAB, cropStage, labScale, solarFraction } from './engine'
import type { EngineeringState } from './engine'

/** Replace graphic input ONLY in SIM mode. The base Field/token record is untouched. */
export function engineeringPresentation(field: FieldVisual, state: EngineeringState): FieldVisual {
  if (field.id !== state.fieldId) throw new Error('Engineering scenario/account identity mismatch')
  return {
    ...field,
    active: state.crop.planted && state.crop.health > 0,
    ready: cropStage(state.crop) === 'mature',
    condition: state.crop.health,
    growth: state.crop.planted ? 0.12 + state.crop.progress * 0.88 : 0,
    fertilized: false, taxExpired: false, mutation: 0,
    engineering: {
      battery: state.batteryKwh / (LAB.batteryCapacityKwh * labScale(state.tier)), water: state.tankL / (LAB.tankCapacityL * labScale(state.tier)),
      light: state.controls.lights && state.crop.planted ? state.last.light : 0,
      solar: solarFraction(state.hour) * (state.hour < state.dustUntil ? 0.18 : 1),
      pumpFault: state.controls.pumpFault || !state.controls.pump,
      dust: state.hour < state.dustUntil,
      flow: state.last.irrigation,
      temperature: state.temperatureC,
      climate: state.controls.climate ? state.last.climateFraction : 0,
      climateCooling: state.last.climateMode === 'cooling',
    },
  }
}
