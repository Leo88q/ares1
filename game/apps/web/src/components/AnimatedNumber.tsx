import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'

interface Props {
 value: number
 decimals?: number
 prefix?: string
 suffix?: string
 className?: string
 style?: React.CSSProperties
}

export default function AnimatedNumber({
 value,
 decimals = 2,
 prefix = '',
 suffix = '',
 className,
 style,
}: Props) {
 const springValue = useSpring(value, {
  stiffness: 100,
  damping: 20,
  mass: 0.5,
 })
 
 const display = useTransform(springValue, (current) =>
  current.toFixed(decimals)
 )

 useEffect(() => {
  springValue.set(value)
 }, [value, springValue])

 return (
  <motion.span className={className} style={style}>
   {prefix}
   <motion.span>{display}</motion.span>
   {suffix}
  </motion.span>
 )
}
