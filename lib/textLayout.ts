// Geometría del bloque de texto de un estilo, compartida por preview, export y
// check de contraste: dónde cae, cuánto se movió y si choca con una imagen.

import type { Canvas } from './canvas'
import type { Cue } from './cues'
import { DIFFUSE_SHADOW, assFontScale, type StylePreset } from './styles/presets'
import type { Layer } from '@/types/project'

/** Desplazamiento del bloque de texto, en % del lienzo, respecto a la posición del estilo. */
export interface TextOffset {
  x: number
  y: number
}

export const NO_OFFSET: TextOffset = { x: 0, y: 0 }
const MAX_OFFSET = 50

export function clampOffset(o: Partial<TextOffset> | null | undefined): TextOffset {
  const c = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(n, -MAX_OFFSET), MAX_OFFSET) : 0
  return { x: c(o?.x), y: c(o?.y) }
}

/**
 * Margen seguro (manual VM pp. 14-15): las plataformas recortan un poco los
 * lados al publicar, así que ningún subtítulo queda pegado al borde. En % del
 * lienzo, por lado.
 */
export const SAFE_MARGIN = { x: 6, y: 6 } as const

/**
 * Desplazamiento que deja el bloque de texto dentro del margen seguro: el que
 * pidió la usuaria, corrido lo justo para no tocar el borde. Lo usan la
 * preview, el export y el contraste.
 */
export function safeOffset(preset: StylePreset, offset: TextOffset, canvas: Canvas): TextOffset {
  const o = clampOffset(offset)
  const p = preset.placement
  // límites horizontales del bloque (en Revista, los dos bloques se mueven juntos)
  const [x0, x1] = p.kind === 'blocks' ? [p.left[0], p.right[1]] : [8, 92]
  const x = Math.min(Math.max(o.x, SAFE_MARGIN.x - x0), 100 - SAFE_MARGIN.x - x1)
  // límites verticales a partir del alto estimado del bloque
  const r = textRect(preset, 'left', { x: 0, y: 0 }, canvas)
  const y = Math.min(Math.max(o.y, SAFE_MARGIN.y - r[1]), 100 - SAFE_MARGIN.y - r[3])
  return { x, y }
}

/**
 * Sombra que se aplica al texto cuando una imagen de apoyo queda debajo:
 * la imagen va detrás y el texto encima con sombra (la misma sombra difusa).
 */
export const COLLISION_SHADOW = { offset: DIFFUSE_SHADOW.distance, alpha: DIFFUSE_SHADOW.alpha }

/**
 * Rectángulo aproximado del texto en % del lienzo [x0, y0, x1, y1]. Vertical:
 * hasta dos líneas base alrededor del centro del bloque, más la línea propia de
 * la palabra resaltada si el estilo la tiene.
 */
export function textRect(
  preset: StylePreset,
  side: 'left' | 'right',
  offset: TextOffset,
  canvas: Canvas
): [number, number, number, number] {
  const p = preset.placement
  const lineH = preset.base.size * assFontScale(preset.base.font)
  // hasta dos líneas base; con palabra resaltada, una línea más para ella (regla 2)
  const emphLines = preset.emphasis ? preset.emphasis.scale : 0
  const halfH = ((lineH * (1.1 + emphLines / 2)) / canvas.h) * 100
  if (p.kind === 'blocks') {
    const [x0, x1] = side === 'left' ? p.left : p.right
    return [x0 + offset.x, 50 + offset.y - halfH, x1 + offset.x, 50 + offset.y + halfH]
  }
  const cy = p.yPercent + offset.y
  return [8 + offset.x, cy - halfH, 92 + offset.x, cy + halfH]
}

/** ¿Alguna imagen activa tapa el texto de este cue (en tiempo y en espacio)? */
export function cueHitsImage(
  cue: Cue,
  rect: [number, number, number, number],
  imageLayers: Layer[]
): boolean {
  return imageLayers.some((l) => {
    if (l.type !== 'image' || l.enabled === false) return false
    if (!(l.start < cue.end && l.end > cue.start)) return false
    const w = l.width ?? 40
    const h = l.height ?? 21
    const x = l.x ?? 50
    const y = l.y ?? 78
    return x - w / 2 < rect[2] && x + w / 2 > rect[0] && y - h / 2 < rect[3] && y + h / 2 > rect[1]
  })
}
