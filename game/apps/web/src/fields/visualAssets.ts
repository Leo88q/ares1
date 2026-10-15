export const FIELD_MODEL_FILES = [
  'row.glb', 'double-row.glb', 'soil.glb', 'sprout.glb', 'plant.glb',
  'canopy.glb', 'pipe.glb', 'support.glb', 'solar.glb', 'rock.glb',
  'platform.glb', 'reservoir.glb', 'battery.glb', 'rail.glb',
  'pump.glb', 'valve.glb', 'climate-unit.glb', 'control-panel.glb',
] as const

export const FIELD_ART = {
  background: '/ares/art/mars-sector.webp',
  panel: '/ares/kit/panel-bronze.webp',
  primary: '/ares/art/button-bronze.webp',
  secondary: '/ares/art/button-bronze.webp',
  tab: '/ares/kit/tab.webp',
  track: '/ares/kit/track.webp',
  fill: '/ares/art/plate-surface.webp',
  knob: '/ares/kit/knob.webp',
} as const

export const RESOURCE_ART = {
  battery: '/ares/art/battery.webp', water: '/ares/art/reservoir.webp', solar: '/ares/art/solar.webp',
  crop: '/ares/icons/sprout.webp', temperature: '/ares/icons/gauge.webp', climate: '/ares/icons/flame.webp',
  pump: '/ares/icons/gear.webp', light: '/ares/icons/flame.webp', food: '/ares/icons/crate.webp',
  service: '/ares/icons/gear.webp', log: '/ares/icons/clipboard.webp', telemetry: '/ares/icons/gauge.webp',
  nutrients: '/ares/flask.webp',
} as const
export type ResourceArt = keyof typeof RESOURCE_ART
