// Regla de contraste verificada contra el fotograma real (solo cliente).
// Se muestrea la zona del video donde cae el texto y se comprueba que cada color
// de texto del estilo se lea: o contrasta por sí solo con el fondo, o lleva un
// borde oscuro (sombra o contorno) y contrasta con ese borde. No se fuerza
// contorno: si falla, se avisa en el selector de estilo antes de exportar.

import { containFit, type Canvas } from './canvas'
import type { StylePreset } from './styles/presets'

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

/**
 * Luminancia del fondo bajo el texto, tomando el percentil alto (las zonas
 * claras son las que rompen la lectura). Usa el mismo encuadre que el export:
 * escalar sin recortar y centrar (pad negro).
 */
export function sampleZoneLuminance(
  video: HTMLVideoElement,
  zone: [number, number, number, number],
  frame: Canvas,
  canvas: HTMLCanvasElement
): number | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh || video.readyState < 2) return null
  const { s, ox, oy } = containFit(frame, vw, vh)
  const toSrc = (pctX: number, pctY: number) => ({
    x: Math.min(Math.max(((pctX / 100) * frame.w - ox) / s, 0), vw),
    y: Math.min(Math.max(((pctY / 100) * frame.h - oy) / s, 0), vh),
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

/** true si algún color de texto del estilo (ya resuelto con sus opciones) no se lee sobre ese fondo. */
export function failsContrast(preset: StylePreset, bgLum: number): boolean {
  const { base, emphasis } = preset
  const readable = (color: string, edge: { outline: number; outlineAlpha: number; outlineColor: string; shadow: number; shadowAlpha: number }) => {
    const fill = hexLum(color)
    if (ratio(fill, bgLum) >= 3) return true
    // borde oscuro: contorno de al menos 2 px al 60%, o la sombra difusa (al menos al 45%)
    const hasOutline = edge.outline >= 2 && edge.outlineAlpha >= 0.6
    const hasShadow = edge.shadow >= 2 && edge.shadowAlpha >= 0.45
    const edgeLum = hasOutline ? hexLum(edge.outlineColor) : 0
    return (hasOutline || hasShadow) && ratio(fill, edgeLum) >= 4.5
  }
  const baseOk = readable(base.color, {
    outline: base.outlineWidth,
    outlineAlpha: base.outlineAlpha,
    outlineColor: base.outlineColor,
    shadow: base.shadowOffset,
    shadowAlpha: base.shadowAlpha,
  })
  if (!baseOk) return true
  if (emphasis) {
    const emphOk = readable(emphasis.color, {
      outline: 0,
      outlineAlpha: 0,
      outlineColor: '#000000',
      shadow: emphasis.shadowOffset,
      shadowAlpha: emphasis.shadowAlpha,
    })
    if (!emphOk) return true
  }
  return false
}
