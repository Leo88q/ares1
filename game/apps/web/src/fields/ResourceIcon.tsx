import { RESOURCE_ART } from './visualAssets'
import type { ResourceArt } from './visualAssets'

/** Actual image assets, not CSS/SVG drawings of equipment. Labels are live DOM. */
export default function ResourceIcon({ kind, size = 32, className = '' }: { kind: ResourceArt; size?: number; className?: string }): JSX.Element {
  return <img src={RESOURCE_ART[kind]} alt="" aria-hidden="true" width={size} height={size} className={`mf-resource-icon ${className}`} draggable={false} />
}
