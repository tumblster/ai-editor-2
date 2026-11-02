// Genera el archivo .ASS que ffmpeg quema con libass.
// Los parámetros salen del mismo preset que usa el preview (lib/styles/presets.ts).

import type { Layer, StylePresetId } from '@/types/project'
import type { Cue } from './cues'
import { DEFAULT_CANVAS, type Canvas } from './canvas'
import { COLLISION_SHADOW, clampOffset, cueHitsImage, textRect, type TextOffset } from './textLayout'
import {
  STYLE_PRESETS,
  assFontSize,
  resolveStyle,
  type EmphasisSpec,
  type StyleOptions,
  type TextStyle,
} from './styles/presets'

/**
 * Tiempo ASS (centésimas). Se redondea hacia abajo: los bordes de los cues caen
 * en la rejilla de fotogramas, y redondear hacia arriba dejaba el cue anterior
 * visible un fotograma de más (y el siguiente entraba un fotograma tarde).
 */
function assTime(s: number): string {
  const totalCs = Math.floor(Math.max(0, s) * 100 + 1e-6)
  const h = Math.floor(totalCs / 360000)
  const m = Math.floor((totalCs % 360000) / 6000)
  const sec = Math.floor((totalCs % 6000) / 100)
  const cc = totalCs % 100
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cc.toString().padStart(2, '0')}`
}

/** hex #RRGGBB → &HBBGGRR& (para tags \c, \3c, \4c) */
function assBgr(hex: string): string {
  const clean = hex.replace('#', '')
  return `&H${clean.slice(4, 6)}${clean.slice(2, 4)}${clean.slice(0, 2)}&`.toUpperCase()
}

/** transparencia ASS (0 opaco..1 transparente) → &HAA& (para tags \1a, \3a, \4a) */
function assAlpha(transparency: number): string {
  const aa = Math.round(Math.min(Math.max(transparency, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `&H${aa}&`
}

/** hex #RRGGBB + alpha (0 opaco..1 transparente) → &HAABBGGRR */
function assColor(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '')
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  const aa = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `&H${aa}${b}${g}${r}`.toUpperCase()
}

function styleLine(
  name: string,
  t: TextStyle,
  alignment: number,
  marginLeft: number,
  marginRight: number,
  marginV: number
): string {
  return [
    `Style: ${name}`,
    t.font,
    assFontSize(t.font, t.size),
    assColor(t.color),
    assColor('#FFFFFF', 1),
    // los presets guardan opacidad (0..1); ASS espera transparencia
    assColor(t.outlineWidth > 0 ? t.outlineColor : '#000000', t.outlineWidth > 0 ? 1 - t.outlineAlpha : 1),
    assColor('#000000', 1 - t.shadowAlpha),
    t.bold ? -1 : 0,
    t.italic ? -1 : 0,
    0, 0, 100, 100, 0, 0, 1,
    t.outlineWidth > 0 ? t.outlineWidth : 0,
    t.shadowOffset,
    alignment,
    marginLeft,
    marginRight,
    marginV,
    1,
  ].join(',')
}

function escapeAss(text: string): string {
  return text.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()
}

function cueText(cue: Cue, base: TextStyle, emph: EmphasisSpec): string {
  const parts: string[] = []
  for (const w of cue.words) {
    let text = escapeAss(w.text)
    if (!text) continue
    if (w.emph) {
      const tags: string[] = []
      tags.push(`\\c${assBgr(emph.color)}`)
      if (emph.scale !== 1 || emph.font) {
        tags.push(`\\fs${assFontSize(emph.font ?? base.font, base.size * emph.scale)}`)
      }
      if (emph.font) tags.push(`\\fn${emph.font}`)
      if (emph.italic) tags.push('\\i1')
      // las palabras de énfasis llevan sombra; donde hay sombra no va contorno
      if (emph.shadowOffset > 0) {
        tags.push(`\\shad${emph.shadowOffset}`)
        tags.push(`\\4c${assBgr('#000000')}`)
        tags.push(`\\4a${assAlpha(1 - emph.shadowAlpha)}`)
        if (base.outlineWidth > 0) tags.push('\\bord0')
      }
      if (emph.uppercase) text = text.toUpperCase()
      parts.push(`{${tags.join('')}}${text}{\\r}`)
    } else {
      parts.push(text)
    }
  }
  return parts.join(' ')
}

export interface AssOptions extends StyleOptions {
  offset?: TextOffset // bloque de texto movido por la usuaria (% del lienzo)
  imageLayers?: Layer[] // para saber cuándo una imagen queda debajo del texto
}

/** Variante del estilo con la sombra de choque (imagen debajo del texto); la sombra prevalece. */
function withCollisionShadow(t: TextStyle): TextStyle {
  if (t.shadowOffset > 0) return t
  return {
    ...t,
    outlineWidth: 0,
    shadowOffset: COLLISION_SHADOW.offset,
    shadowAlpha: COLLISION_SHADOW.alpha,
  }
}

export function buildAss(
  styleId: StylePresetId,
  cues: Cue[],
  totalDuration: number,
  canvas: Canvas = DEFAULT_CANVAS,
  options: AssOptions = {}
): string {
  const W = canvas.w
  const H = canvas.h
  const preset = resolveStyle(STYLE_PRESETS[styleId], options)
  const offset = clampOffset(options.offset)
  const imageLayers = options.imageLayers ?? []
  const header = [
    '[Script Info]',
    '; Generado por el editor — Fase 1',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    // 1 = corte de línea al final (como CSS); 0 balanceaba las líneas y partía distinto
    'WrapStyle: 1',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ]

  const styles: string[] = []
  const events: string[] = [
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const px = (p: number, size: number) => Math.round((p / 100) * size)
  const shadowed = withCollisionShadow(preset.base)
  const textOf = (cue: Cue, base: TextStyle) =>
    preset.emphasis
      ? cueText(cue, base, preset.emphasis)
      : cue.words.map((w) => escapeAss(w.text)).filter(Boolean).join(' ')
  // Con \pos, libass sigue usando los márgenes del estilo para el ancho de corte
  // de línea: el ancho del bloque se mantiene y \pos lo mueve.
  const hits = (cue: Cue) => cueHitsImage(cue, textRect(preset, cue.side, offset, canvas), imageLayers)

  if (preset.placement.kind === 'blocks') {
    const pl = preset.placement
    const [l0, l1] = pl.left
    const [r0, r1] = pl.right
    styles.push(styleLine('RevL', preset.base, 4, px(l0, W), W - px(l1, W), 0))
    styles.push(styleLine('RevR', preset.base, 6, px(r0, W), W - px(r1, W), 0))
    styles.push(styleLine('RevLS', shadowed, 4, px(l0, W), W - px(l1, W), 0))
    styles.push(styleLine('RevRS', shadowed, 6, px(r0, W), W - px(r1, W), 0))
    // Banda vertical: dibujo \p1 — con Fontsize 64 la escala del dibujo es 1 unidad = 1 px.
    // Es decoración del estilo: no se mueve con el texto.
    const x0 = px(pl.band[0], W)
    const x1 = px(pl.band[1], W)
    // relleno blanco con la misma opacidad que la preview (bandAlpha es opacidad)
    const bandStyle = [
      'Style: Band',
      'Arial',
      64,
      assColor('#FFFFFF', 1 - pl.bandAlpha),
      assColor('#FFFFFF', 1),
      assColor('#000000', 1),
      assColor('#000000', 1),
      0, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 7, 0, 0, 0, 1,
    ].join(',')
    styles.push(bandStyle)
    events.push(
      `Dialogue: 0,${assTime(0)},${assTime(totalDuration)},Band,,0,0,0,,{\\an7\\pos(0,0)\\p1}m ${x0} 0 l ${x1} 0 l ${x1} ${H} l ${x0} ${H}{\\p0}`
    )
    const y = px(50 + offset.y, H)
    for (const cue of cues) {
      const hit = hits(cue)
      const text = textOf(cue, hit ? shadowed : preset.base)
      if (!text) continue
      const left = cue.side === 'left'
      const style = (left ? 'RevL' : 'RevR') + (hit ? 'S' : '')
      const pos = left ? `\\an4\\pos(${px(l0 + offset.x, W)},${y})` : `\\an6\\pos(${px(r1 + offset.x, W)},${y})`
      // texto (capa 1) encima de la banda (capa 0), como en la preview
      events.push(`Dialogue: 1,${assTime(cue.start)},${assTime(cue.end)},${style},,0,0,0,,{${pos}}${text}`)
    }
  } else {
    styles.push(styleLine('Main', preset.base, 5, px(8, W), px(8, W), 0))
    styles.push(styleLine('MainS', shadowed, 5, px(8, W), px(8, W), 0))
    const x = px(50 + offset.x, W)
    const y = px(preset.placement.yPercent + offset.y, H)
    for (const cue of cues) {
      const hit = hits(cue)
      const text = textOf(cue, hit ? shadowed : preset.base)
      if (!text) continue
      events.push(
        `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${hit ? 'MainS' : 'Main'},,0,0,0,,{\\an5\\pos(${x},${y})}${text}`
      )
    }
  }

  return [...header, ...styles, ...events].join('\n') + '\n'
}
