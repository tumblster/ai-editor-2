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

/**
 * Sombra difusa (Playbook regla 1, valores de partida del manual VM: negro,
 * Opacity 55%, Blurriness 17%, Distance 5, Angle -45°), traducida al lienzo:
 * - opacidad 55%;
 * - desenfoque: 17% del tamaño de la letra como radio CSS. libass difumina
 *   más con el mismo número (medido: \blur 4 ≈ 6 px CSS, \blur 8 ≈ 12 px), así
 *   que el ASS usa el radio CSS / 1.5;
 * - distancia: 3 px a -45° (abajo a la derecha), 2 px por eje. El manual da
 *   5 en unidades de su editor; aquí se deja casi sin desplazamiento porque la
 *   regla 1 pide que la sombra no se note corrida hacia un lado.
 */
export const DIFFUSE_SHADOW = { alpha: 0.55, blur: 0.17, distance: 3, angleDeg: -45 } as const
const ASS_BLUR_FACTOR = 1.5

/** Desplazamiento por eje (x a la derecha, y hacia abajo) de la sombra a -45°. */
export function shadowXY(distance: number): { x: number; y: number } {
  const d = Math.round(Math.max(0, distance) * Math.SQRT1_2)
  return { x: d, y: d }
}

/** Radio de desenfoque CSS (text-shadow) para una letra de `size` px. */
export function shadowBlurCss(size: number): number {
  return Math.round(size * DIFFUSE_SHADOW.blur)
}

/** Valor de \blur de libass equivalente al radio CSS. */
export function shadowBlurAss(size: number): number {
  return Math.round((shadowBlurCss(size) / ASS_BLUR_FACTOR) * 10) / 10
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
  shadowOffset: number // distancia de la sombra difusa en px (0 = sin sombra); ver DIFFUSE_SHADOW
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

// Sombra y contorno (decisión del usuario): toda sombra es la difusa (DIFFUSE_SHADOW).
// - Sombra activa por defecto en títulos y textos grandes (Chispa, Revista,
//   Titular) y en las palabras de énfasis; apagada en subtitulado simple
//   (Claro, Foco).
// - Contorno opcional por estilo, apagado por defecto, activable en los 5 estilos.
// - Si sombra y contorno están activos a la vez, se dibuja un contorno fino
//   detrás de la sombra y la sombra sigue prevaleciendo visualmente.
// - El contraste no se fuerza con contorno: el check avisa contra el frame real.
export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  chispa: {
    id: 'chispa',
    name: 'Chispa',
    base: {
      font: 'Trebuchet MS', bold: true, italic: false, size: 88,
      color: '#F5E9CE', ...NO_OUTLINE,
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
    },
    outline: { width: 2, color: '#000000', alpha: 0.75 },
    cueWords: 3,
    placement: { kind: 'center', yPercent: 31.5 },
    emphasis: {
      scope: 'keyword', uppercase: true, scale: 1.3, color: '#FFF7E0', italic: false,
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
    },
  },
  revista: {
    id: 'revista',
    name: 'Revista',
    base: {
      font: 'Georgia', bold: false, italic: false, size: 56,
      color: '#FFFFFF', ...NO_OUTLINE,
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
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
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
    },
    outline: { width: 2, color: '#000000', alpha: 0.75 },
    cueWords: 5,
    placement: { kind: 'center', yPercent: 49.5 },
    emphasis: {
      scope: 'keyword', uppercase: false, scale: 1.5, color: '#F7E01C', italic: true,
      font: 'Georgia', shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
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
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
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
      shadowOffset: DIFFUSE_SHADOW.distance, shadowAlpha: DIFFUSE_SHADOW.alpha,
    },
  },
}

export const STYLE_IDS = Object.keys(STYLE_PRESETS) as StylePresetId[]

export interface StyleOptions {
  outline?: boolean
}

/**
 * Estilo tal como se dibuja con las opciones de la usuaria. Lo usan la preview
 * y el export, así que los dos aplican la misma regla: con el check Contorno
 * encendido, el estilo lleva su contorno fino, en todos los estilos.
 */
export function resolveStyle(preset: StylePreset, opts: StyleOptions = {}): StylePreset {
  return {
    ...preset,
    base: opts.outline
      ? {
          ...preset.base,
          outlineWidth: preset.outline.width,
          outlineColor: preset.outline.color,
          outlineAlpha: preset.outline.alpha,
        }
      : { ...preset.base, ...NO_OUTLINE },
  }
}

/**
 * Con contorno encendido, el texto se dibuja en dos capas para que el contorno
 * quede detrás de la sombra (libass y CSS pintan el contorno encima de la
 * sombra si van en la misma capa):
 * - under: el texto con su contorno fino y sin ninguna sombra;
 * - over: el mismo texto con sus sombras (base y énfasis) y sin contorno.
 * La capa de arriba cubre el contorno donde se cruza con la sombra: la sombra
 * prevalece visualmente. Sin contorno, devuelve null (una sola capa).
 */
export function outlineLayers(preset: StylePreset): { under: StylePreset; over: StylePreset } | null {
  if (preset.base.outlineWidth <= 0) return null
  return {
    under: {
      ...preset,
      base: { ...preset.base, shadowOffset: 0, shadowAlpha: 0 },
      emphasis: preset.emphasis ? { ...preset.emphasis, shadowOffset: 0, shadowAlpha: 0 } : null,
    },
    over: { ...preset, base: { ...preset.base, ...NO_OUTLINE } },
  }
}
