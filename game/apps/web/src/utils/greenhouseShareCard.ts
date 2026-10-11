export interface GreenhouseShareCardData {
  readonly title: string
  readonly subtitle: string
  readonly cycleLabel: string
  readonly cycleValue: string
  readonly fieldsLabel: string
  readonly fieldsValue: string
  readonly mutationLabel: string
  readonly mutationValue: string
  readonly levelLabel: string
  readonly levelValue: string
  readonly missionsLabel: string
  readonly missionsValue: string
  readonly walletLabel: string
  readonly networkLabel: string
  readonly disclaimer: string
}

/** Draws a self-contained share image without sending wallet data to a server. */
export function createGreenhouseShareCard(data: GreenhouseShareCardData): Promise<Blob> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Canvas is unavailable.'))

  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas is unavailable.'))

  const background = ctx.createLinearGradient(0, 0, 1200, 630)
  background.addColorStop(0, '#120d08')
  background.addColorStop(0.55, '#24160d')
  background.addColorStop(1, '#0d0906')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 1200, 630)

  // Subtle dust/star field; fixed positions keep every player's card stable.
  for (let i = 0; i < 74; i++) {
    const x = (i * 197 + 83) % 1200
    const y = (i * 113 + 41) % 630
    const radius = i % 9 === 0 ? 2 : 1
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = i % 4 === 0 ? 'rgba(255, 179, 71, 0.55)' : 'rgba(242, 232, 218, 0.3)'
    ctx.fill()
  }

  const glow = ctx.createRadialGradient(950, 130, 30, 950, 130, 440)
  glow.addColorStop(0, 'rgba(193, 68, 14, 0.25)')
  glow.addColorStop(1, 'rgba(193, 68, 14, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 1200, 630)

  ctx.strokeStyle = 'rgba(255, 179, 71, 0.58)'
  ctx.lineWidth = 2
  ctx.strokeRect(32, 32, 1136, 566)
  ctx.strokeStyle = 'rgba(255, 224, 178, 0.14)'
  ctx.lineWidth = 1
  ctx.strokeRect(44, 44, 1112, 542)

  ctx.fillStyle = '#ffb347'
  ctx.font = '700 20px "JetBrains Mono", monospace'
  ctx.letterSpacing = '4px'
  ctx.fillText('ARES-1  /  COLONY OPERATIONS', 76, 94)

  ctx.fillStyle = '#f6f1ed'
  ctx.font = '700 50px "Oswald", "Arial Narrow", sans-serif'
  ctx.letterSpacing = '1px'
  ctx.fillText(data.title, 76, 170, 1040)

  ctx.fillStyle = '#e0a183'
  ctx.font = '400 22px "Inter", Arial, sans-serif'
  ctx.letterSpacing = '0px'
  ctx.fillText(data.subtitle, 78, 210, 1020)

  const cards = [
    { label: data.cycleLabel, value: data.cycleValue },
    { label: data.fieldsLabel, value: data.fieldsValue },
    { label: data.mutationLabel, value: data.mutationValue },
    { label: data.levelLabel, value: data.levelValue },
  ]
  const cardTop = 270
  const cardWidth = 246
  const cardGap = 18
  cards.forEach((card, index) => {
    const x = 76 + index * (cardWidth + cardGap)
    ctx.fillStyle = 'rgba(18, 12, 7, 0.76)'
    ctx.fillRect(x, cardTop, cardWidth, 112)
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.35)'
    ctx.strokeRect(x, cardTop, cardWidth, 112)
    ctx.fillStyle = '#c9a176'
    ctx.font = '600 16px "JetBrains Mono", monospace'
    ctx.letterSpacing = '2px'
    ctx.fillText(card.label.toUpperCase(), x + 18, cardTop + 33, cardWidth - 36)
    ctx.fillStyle = '#ffc94a'
    ctx.font = '700 38px "Oswald", "Arial Narrow", sans-serif'
    ctx.letterSpacing = '0px'
    ctx.fillText(card.value, x + 18, cardTop + 84, cardWidth - 36)
  })

  ctx.fillStyle = '#f6f1ed'
  ctx.font = '600 20px "Inter", Arial, sans-serif'
  ctx.letterSpacing = '0px'
  ctx.fillText(`${data.missionsLabel}: ${data.missionsValue}`, 78, 440, 1020)

  ctx.fillStyle = 'rgba(224, 161, 131, 0.88)'
  ctx.font = '500 16px "JetBrains Mono", monospace'
  ctx.letterSpacing = '1px'
  ctx.fillText(data.walletLabel, 78, 492, 1020)

  ctx.fillStyle = '#ffb347'
  ctx.font = '700 17px "JetBrains Mono", monospace'
  ctx.letterSpacing = '2px'
  ctx.fillText(data.networkLabel.toUpperCase(), 78, 548, 1020)

  ctx.fillStyle = 'rgba(224, 161, 131, 0.76)'
  ctx.font = '400 14px "Inter", Arial, sans-serif'
  ctx.letterSpacing = '0px'
  ctx.fillText(data.disclaimer, 78, 575, 1020)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not render share image.'))
    }, 'image/png')
  })
}
