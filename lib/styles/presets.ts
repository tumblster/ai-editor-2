// Parámetros cerrados de los cinco estilos predefinidos de Fase 1.
// Nombres públicos exactos; nunca nombres de creadores (ni aquí, ni en UI, ni en marketing).
// Los mismos números alimentan el render de preview (CSS) y el quemado de export (ASS),
// para que lo que se ve sea lo que sale en el MP4.
// La legibilidad se verifica contra el fotograma real (lib/contrast.ts).

import type { StylePresetId } from '@/types/project'

// Lienzo de diseño: el export es 1080x1920 (9:16) y el preview escala desde aquí.
export const DESIGN_W = 1080
export const DESIGN_H = 1920

/**
 * libass escala la fuente para que ascendente + descendente (métricas win del
 * archivo de fuente) midan el Fontsize; CSS escala el em. Para que el MP4 tenga
 * el mismo tamaño que la preview, el ASS usa size × este factor.
 * Valores de (usWinAscent + usWinDescent) / unitsPerEm de cada fuente.
 */
const ASS_FONT_SCALE: Record<string, number> = {
  Arial: 1.117,
  Georgia: 1.136,
  'Trebuchet MS': 1.161,
}

export function assFontScale(font: string): number {
  return ASS_FONT_SCALE[font] ?? 1.15
}

export function assFontSize(font: string, cssPx: number): number {
  return Math.round(cssPx * assFontScale(font))
}

export interface TextStyle {
  font: string
  bold: boolean
  italic: boolean
  size: number // px sobre el lienzo (lado corto = 1080 px)
  color: string // hex
  outlineWidth: number // px; 0 = sin contorno
  outlineColor: string // hex
  outlineAlpha: number
  shadowOffset: number // px, offset duro como ASS (sin blur)
  shadowAlpha: number // 0-1
}

export type Placement =
  | { kind: 'center'; yPercent: number } // centro horizontal; % vertical del centro del bloque
  | {
      kind: 'blocks'
      left: [number, number] // [% ancho] bloque izquierdo
      right: [number, number] // [% ancho] bloque derecho
      band: [number, number] // [% ancho] banda vertical
      bandAlpha: number
    }

export interface EmphasisSpec {
  scope: 'keyword' | 'numbers'
  uppercase: boolean
  scale: number
  color: string
  italic: boolean
  font?: string
  // Las palabras de énfasis siempre llevan sombra
  shadowOffset: number
  shadowAlpha: number
}

/** Contorno opcional del estilo: apagado por defecto, se activa por estilo. */
export interface OutlineSpec {
  width: number
  color: string
  alpha: number // opacidad 0-1
}

export interface StylePreset {
  id: StylePresetId
  name: string
  base: TextStyle // tal como se dibuja (resolveStyle aplica las opciones)
  outline: OutlineSpec
  cueWords: number // máx de palabras por cue (Chispa agrupa 1-3)
  placement: Placement
  emphasis: EmphasisSpec | null
}

const NO_OUTLINE = { outlineWidth: 0, outlineColor: '#000000', outlineAlpha: 0 }

// Sombra y contorno (decisión del usuario):
// - Sombra activa por defecto en títulos y textos grandes (Chispa, Revista,
//   Titular) y en las palabras de énfasis; apagada en subtitulado simple
//   (Claro, Foco).
// - Contorno opcional por estilo, apagado por defecto.
// - Si sombra y contorno están activos a la vez, la sombra prevalece.
// - El contraste no se fuerza con contorno: el check avisa contra el frame real.
export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  chispa: {
    id: 'chispa',
    name: 'Chispa',
    base: {
      font: 'Trebuchet MS', bold: true, italic: false, size: 88,
      color: '#F5E9CE', ...NO_OUTLINE,
      shadowOffset: 5, shadowAlpha: 0.55,
    },
    outline: { width: 3, color: '#000000', alpha: 0.75 },
    cueWords: 3,
    placement: { kind: 'center', yPercent: 31.5 },
    emphasis: {
      scope: 'keyword', uppercase: true, scale: 1.3, color: '#FFF7E0', italic: false,
      shadowOffset: 5, shadowAlpha: 0.55,
    },
  },
  revista: {
    id: 'revista',
    name: 'Revista',
    base: {
      font: 'Georgia', bold: false, italic: false, size: 56,
      color: '#FFFFFF', ...NO_OUTLINE,
      shadowOffset: 3, shadowAlpha: 0.5,
    },
    outline: { width: 2, color: '#000000', alpha: 0.7 },
    cueWords: 5,
    placement: {
      kind: 'blocks',
      left: [8, 38], right: [60, 85], band: [35, 45], bandAlpha: 0.14,
    },
    emphasis: null,
  },
  titular: {
    id: 'titular',
    name: 'Titular',
    base: {
      font: 'Arial', bold: true, italic: false, size: 64,
      color: '#FFFFFF', ...NO_OUTLINE,
      shadowOffset: 4, shadowAlpha: 0.55,
    },
    outline: { width: 2.5, color: '#000000', alpha: 0.75 },
    cueWords: 5,
    placement: { kind: 'center', yPercent: 49.5 },
    emphasis: {
      scope: 'keyword', uppercase: false, scale: 1.5, color: '#F7E01C', italic: true,
      font: 'Georgia', shadowOffset: 4, shadowAlpha: 0.65,
    },
  },
  claro: {
    id: 'claro',
    name: 'Claro',
    base: {
      font: 'Arial', bold: true, italic: false, size: 60,
      color: '#FFFFFF', ...NO_OUTLINE,
      shadowOffset: 0, shadowAlpha: 0,
    },
    outline: { width: 2.5, color: '#000000', alpha: 0.75 },
    cueWords: 5,
    placement: { kind: 'center', yPercent: 59.5 },
    emphasis: {
      scope: 'keyword', uppercase: false, scale: 1.0, color: '#F9EEAF', italic: false,
      shadowOffset: 3, shadowAlpha: 0.6,
    },
  },
  foco: {
    id: 'foco',
    name: 'Foco',
    base: {
      font: 'Trebuchet MS', bold: true, italic: false, size: 58,
      color: '#FFFFFF', ...NO_OUTLINE,
      shadowOffset: 0, shadowAlpha: 0,
    },
    outline: { width: 2.5, color: '#0C0C10', alpha: 0.9 },
    cueWords: 5,
    placement: { kind: 'center', yPercent: 70 },
    emphasis: {
      scope: 'numbers', uppercase: false, scale: 1.15, color: '#FFD84D', italic: false,
      shadowOffset: 3, shadowAlpha: 0.6,
    },
  },
}

export const STYLE_IDS = Object.keys(STYLE_PRESETS) as StylePresetId[]

export interface StyleOptions {
  outline?: boolean
}

/**
 * Estilo tal como se dibuja con las opciones de la usuaria. Lo usan la preview
 * y el export, así que los dos aplican la misma regla:
 * el contorno solo se dibuja donde no hay sombra (la sombra prevalece).
 */
export function resolveStyle(preset: StylePreset, opts: StyleOptions = {}): StylePreset {
  const useOutline = !!opts.outline && preset.base.shadowOffset <= 0
  return {
    ...preset,
    base: useOutline
      ? {
          ...preset.base,
          outlineWidth: preset.outline.width,
          outlineColor: preset.outline.color,
          outlineAlpha: preset.outline.alpha,
        }
      : { ...preset.base, ...NO_OUTLINE },
  }
}
