// Regla de contraste verificada contra el fotograma real (solo cliente).
// Se muestrea la zona del video donde cae el texto y se comprueba que cada color
// de texto del estilo se lea: o contrasta por sí solo con el fondo, o lleva un
// borde oscuro suficiente (contorno o caja) y contrasta con ese borde.

import { DESIGN_H, DESIGN_W, type StylePreset } from './styles/presets'

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function hexLum(hex: string): number {
  const c = hex.replace('#', '')
  return luminance(parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16))
}

function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** Zona del texto en % del lienzo 1080x1920: [x0, y0, x1, y1]. */
function textZone(preset: StylePreset, side: 'left' | 'right'): [number, number, number, number] {
  const p = preset.placement
  if (p.kind === 'blocks') {
    const [x0, x1] = side === 'left' ? p.left : p.right
    return [x0, 40, x1, 60]
  }
  return [8, p.yPercent - 6, 92, p.yPercent + 6]
}

/**
 * Luminancia del fondo bajo el texto, tomando el percentil alto (las zonas
 * claras son las que rompen la lectura). Usa el mismo encuadre que el export:
 * escalar sin recortar y centrar (pad negro).
 */
export function sampleZoneLuminance(
  video: HTMLVideoElement,
  zone: [number, number, number, number],
  canvas: HTMLCanvasElement
): number | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh || video.readyState < 2) return null
  const s = Math.min(DESIGN_W / vw, DESIGN_H / vh)
  const ox = (DESIGN_W - vw * s) / 2
  const oy = (DESIGN_H - vh * s) / 2
  const toSrc = (pctX: number, pctY: number) => ({
    x: Math.min(Math.max(((pctX / 100) * DESIGN_W - ox) / s, 0), vw),
    y: Math.min(Math.max(((pctY / 100) * DESIGN_H - oy) / s, 0), vh),
  })
  const a = toSrc(zone[0], zone[1])
  const b = toSrc(zone[2], zone[3])
  const sw = b.x - a.x
  const sh = b.y - a.y
  if (sw < 1 || sh < 1) return 0 // la zona cae en el pad negro

  const W = 48
  const H = 12
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(video, a.x, a.y, sw, sh, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    const lums: number[] = []
    for (let i = 0; i < data.length; i += 4) lums.push(luminance(data[i], data[i + 1], data[i + 2]))
    lums.sort((x, y) => x - y)
    return lums[Math.floor(lums.length * 0.9)]
  } catch {
    return null
  }
}

/** true si algún color de texto del estilo no se lee sobre ese fondo. */
export function failsContrast(preset: StylePreset, bgLum: number): boolean {
  const { base, emphasis } = preset
  const check = (color: string, edgeWidth: number, edgeAlpha: number, edgeColor: string) => {
    const fill = hexLum(color)
    if (ratio(fill, bgLum) >= 3) return true
    // borde oscuro: contorno de al menos 2 px y 60% de opacidad
    const strongEdge = edgeWidth >= 2 && edgeAlpha >= 0.6
    return strongEdge && ratio(fill, hexLum(edgeColor)) >= 4.5
  }
  const baseOk = check(base.color, base.outlineWidth, base.outlineAlpha, base.outlineColor)
  if (!baseOk) return true
  if (emphasis) {
    const w = emphasis.outlineWidth ?? base.outlineWidth
    const a = emphasis.outlineWidth ? emphasis.outlineAlpha ?? 0.8 : base.outlineAlpha
    const c = emphasis.outlineWidth ? '#000000' : base.outlineColor
    if (!check(emphasis.color, w, a, c)) return true
  }
  return false
}

export function zoneFor(preset: StylePreset, side: 'left' | 'right' = 'left') {
  return textZone(preset, side)
}
