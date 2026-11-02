// Genera el archivo .ASS que ffmpeg quema con libass.
// Los parámetros salen del mismo preset que usa el preview (lib/styles/presets.ts).

import type { Layer, StylePresetId } from '@/types/project'
import { cueLines, type Cue } from './cues'
import { DEFAULT_CANVAS, type Canvas } from './canvas'
import { COLLISION_SHADOW, clampOffset, cueHitsImage, textRect, type TextOffset } from './textLayout'
import {
  DIFFUSE_SHADOW,
  STYLE_PRESETS,
  assFontSize,
  shadowBlurAss,
  shadowXY,
  outlineLayers,
  resolveStyle,
  type EmphasisSpec,
  type StyleOptions,
  type StylePreset,
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
  marginV: number,
  primaryTransparency = 0
): string {
  return [
    `Style: ${name}`,
    t.font,
    assFontSize(t.font, t.size),
    assColor(t.color, primaryTransparency),
    assColor('#FFFFFF', 1),
    // los presets guardan opacidad (0..1); ASS espera transparencia
    assColor(t.outlineWidth > 0 ? t.outlineColor : '#000000', t.outlineWidth > 0 ? 1 - t.outlineAlpha : 1),
    assColor('#000000', t.shadowOffset > 0 ? 1 - t.shadowAlpha : 1),
    t.bold ? -1 : 0,
    t.italic ? -1 : 0,
    0, 0, 100, 100, 0, 0, 1,
    t.outlineWidth > 0 ? t.outlineWidth : 0,
    // la sombra va a -45° (abajo a la derecha): ASS usa el mismo valor en x e y
    t.shadowOffset > 0 ? shadowXY(t.shadowOffset).x : 0,
    alignment,
    marginLeft,
    marginRight,
    marginV,
    1,
  ].join(',')
}

/** Relleno casi transparente: libass no dibuja la sombra si el relleno es 100% transparente. */
const SHADOW_ONLY_FILL = 254 / 255

/** Estilo de la capa de sombra difusa: solo se ve la sombra (los palabras sin sombra quedan invisibles). */
function shadowStyleLine(name: string, t: TextStyle, alignment: number, mL: number, mR: number, emphHasShadow: boolean): string {
  const withShadow = { ...t, outlineWidth: 0, shadowOffset: t.shadowOffset > 0 ? t.shadowOffset : DIFFUSE_SHADOW.distance }
  // si la base no lleva sombra, la capa queda transparente salvo las palabras de énfasis
  const line = styleLine(name, withShadow, alignment, mL, mR, 0, SHADOW_ONLY_FILL)
  if (t.shadowOffset > 0 || !emphHasShadow) return line
  const f = line.split(',')
  f[6] = assColor('#000000', 1) // BackColour transparente para las palabras base
  return f.join(',')
}

function escapeAss(text: string): string {
  return text.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()
}

type LayerMode = 'fill' | 'shadow'

/**
 * Texto de un cue para una capa:
 * - fill: relleno nítido, sin sombra (y con el contorno del estilo si es la capa de contorno);
 * - shadow: solo la sombra difusa (\blur), con el desenfoque según el tamaño de cada palabra.
 */
function cueText(cue: Cue, base: TextStyle, emph: EmphasisSpec | null, mode: LayerMode): string {
  const baseBlur = mode === 'shadow' ? `\\blur${shadowBlurAss(base.size)}` : ''
  const word = (w: Cue['words'][number]): string => {
    let text = escapeAss(w.text)
    if (!text) return ''
    if (!(w.emph && emph)) return text
    const tags: string[] = []
    tags.push(`\\c${assBgr(emph.color)}`)
    if (emph.scale !== 1 || emph.font) {
      tags.push(`\\fs${assFontSize(emph.font ?? base.font, base.size * emph.scale)}`)
    }
    if (emph.font) tags.push(`\\fn${emph.font}`)
    if (emph.italic) tags.push('\\i1')
    if (mode === 'shadow') {
      // las palabras de énfasis llevan su sombra difusa
      if (emph.shadowOffset > 0) {
        tags.push(`\\shad${shadowXY(emph.shadowOffset).x}`)
        tags.push(`\\4a${assAlpha(1 - emph.shadowAlpha)}`)
        tags.push(`\\blur${shadowBlurAss(base.size * emph.scale)}`)
      } else {
        tags.push('\\4a&HFF&')
      }
    }
    if (emph.uppercase) text = text.toUpperCase()
    // \r vuelve al estilo; el desenfoque no es del estilo y se repone
    return `{${tags.join('')}}${text}{\\r${baseBlur}}`
  }
  // regla 2: la palabra resaltada va sola en su línea (\N fuerza el salto)
  const body = cueLines(emph ? cue.words : cue.words.map((w) => ({ ...w, emph: false })))
    .map((line) => line.map(word).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\\N')
  return baseBlur && body ? `{${baseBlur}}${body}` : body
}

/** ¿El cue deja ver alguna sombra (base, énfasis presente o choque con imagen)? */
function cueHasShadow(cue: Cue, base: TextStyle, emph: EmphasisSpec | null): boolean {
  if (base.shadowOffset > 0) return true
  return !!emph && emph.shadowOffset > 0 && cue.words.some((w) => w.emph)
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
  // Capas por frase, de abajo hacia arriba:
  //   contorno fino (solo con el check Contorno) → sombra difusa → relleno nítido.
  // La sombra va en su capa para que \blur no desenfoque las letras, y queda
  // encima del contorno: la sombra prevalece.
  const layers = outlineLayers(preset)
  const over = layers ? layers.over : preset
  const under = layers?.under ?? null
  const fillBase: TextStyle = { ...over.base, shadowOffset: 0, shadowAlpha: 0 }
  const collisionBase = withCollisionShadow(over.base)
  const emph = over.emphasis
  const emphHasShadow = !!emph && emph.shadowOffset > 0
  // Con \pos, libass sigue usando los márgenes del estilo para el ancho de corte
  // de línea: el ancho del bloque se mantiene y \pos lo mueve.
  const hits = (cue: Cue) => cueHitsImage(cue, textRect(preset, cue.side, offset, canvas), imageLayers)

  /** Estilos de un hueco de texto (centro, o bloque izquierdo/derecho de Revista). */
  const slotStyles = (n: string, align: number, mL: number, mR: number) => {
    styles.push(styleLine(n, fillBase, align, mL, mR, 0))
    styles.push(shadowStyleLine(`${n}Sh`, over.base, align, mL, mR, emphHasShadow))
    styles.push(shadowStyleLine(`${n}ShC`, collisionBase, align, mL, mR, emphHasShadow))
    if (under) styles.push(styleLine(`${n}U`, under.base, align, mL, mR, 0))
  }
  /** Eventos de un cue en sus capas, a partir de la capa `layer0`. */
  const emitCue = (cue: Cue, n: string, pos: string, layer0: number) => {
    const t0 = assTime(cue.start)
    const t1 = assTime(cue.end)
    const fill = cueText(cue, fillBase, emph, 'fill')
    if (!fill) return
    if (under) events.push(`Dialogue: ${layer0},${t0},${t1},${n}U,,0,0,0,,${pos}${cueText(cue, under.base, under.emphasis, 'fill')}`)
    const hit = hits(cue)
    const shadowBase = hit ? collisionBase : over.base
    if (cueHasShadow(cue, shadowBase, emph)) {
      events.push(`Dialogue: ${layer0 + 1},${t0},${t1},${n}${hit ? 'ShC' : 'Sh'},,0,0,0,,${pos}${cueText(cue, shadowBase, emph, 'shadow')}`)
    }
    events.push(`Dialogue: ${layer0 + 2},${t0},${t1},${n},,0,0,0,,${pos}${fill}`)
  }

  if (preset.placement.kind === 'blocks') {
    const pl = preset.placement
    const [l0, l1] = pl.left
    const [r0, r1] = pl.right
    slotStyles('RevL', 4, px(l0, W), W - px(l1, W))
    slotStyles('RevR', 6, px(r0, W), W - px(r1, W))
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
      const left = cue.side === 'left'
      const pos = left ? `{\\an4\\pos(${px(l0 + offset.x, W)},${y})}` : `{\\an6\\pos(${px(r1 + offset.x, W)},${y})}`
      // banda en la capa 0; el texto empieza en la 1
      emitCue(cue, left ? 'RevL' : 'RevR', pos, 1)
    }
  } else {
    slotStyles('Main', 5, px(8, W), px(8, W))
    const x = px(50 + offset.x, W)
    const y = px(preset.placement.yPercent + offset.y, H)
    for (const cue of cues) emitCue(cue, 'Main', `{\\an5\\pos(${x},${y})}`, 0)
  }

  return [...header, ...styles, ...events].join('\n') + '\n'
}
