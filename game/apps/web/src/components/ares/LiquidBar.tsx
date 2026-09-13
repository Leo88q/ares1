import { memo } from 'react'
import type { CSSProperties } from 'react'

interface LiquidBarProps {
 value: number
 height?: number
 label?: string
}

/** Колба с янтарной водой и настоящими всплывающими пузырьками. */
export const LiquidBar = memo(function LiquidBar({ value, height = 14, label }: LiquidBarProps): JSX.Element {
 const v = Math.min(100, Math.max(0, value))

 return (
  <div
   className="ares-liquid-bar"
   style={{ height, borderRadius: height / 2 }}
   role="progressbar"
   aria-valuenow={Math.round(v)}
   aria-valuemax={100}
   aria-label={label}
  >
   <div className="ares-liquid-fill" style={{ width: `${v}%`, '--rise': `${height}px` } as CSSProperties}>

   </div>
  </div>
 )
})
