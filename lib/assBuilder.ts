// Genera el archivo .ASS que ffmpeg quema con libass.
// Los parámetros salen del mismo preset que usa el preview (lib/styles/presets.ts).

import type { StylePresetId } from '@/types/project'
import type { Cue } from './cues'
import { DESIGN_H, DESIGN_W, STYLE_PRESETS, type TextStyle } from './styles/presets'

function assTime(s: number): string {
  const clamped = Math.max(0, s)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const sec = Math.floor(clamped % 60)
  const cs = Math.round((clamped - Math.floor(clamped)) * 100)
  const cc = cs === 100 ? 0 : cs
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cc.toString().padStart(2, '0')}`
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
    Math.round(t.size),
    assColor(t.color),
    assColor('#FFFFFF', 1),
    assColor(t.outlineWidth > 0 ? t.outlineColor : '#000000', t.outlineWidth > 0 ? t.outlineAlpha : 1),
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

function cueText(cue: Cue, base: TextStyle, emph: NonNullable<typeof STYLE_PRESETS['chispa']['emphasis']>): string {
  const parts: string[] = []
  for (const w of cue.words) {
    let text = escapeAss(w.text)
    if (!text) continue
    if (w.emph) {
      const tags: string[] = []
      tags.push(`\\c${assColor(emph.color)}`)
      if (emph.scale !== 1) tags.push(`\\fs${Math.round(base.size * emph.scale)}`)
      if (emph.font) tags.push(`\\fn${emph.font}`)
      if (emph.italic) tags.push('\\i1')
      if (emph.outlineWidth) {
        tags.push(`\\bord${emph.outlineWidth}`)
        tags.push(`\\3c${assColor('#000000', emph.outlineAlpha ?? 0.8)}`)
      }
      if (emph.uppercase) text = text.toUpperCase()
      parts.push(`{${tags.join('')}}${text}{\\r}`)
    } else {
      parts.push(text)
    }
  }
  return parts.join(' ')
}

export function buildAss(styleId: StylePresetId, cues: Cue[], totalDuration: number): string {
  const preset = STYLE_PRESETS[styleId]
  const header = [
    '[Script Info]',
    '; Generado por el editor — Fase 1',
    'ScriptType: v4.00+',
    `PlayResX: ${DESIGN_W}`,
    `PlayResY: ${DESIGN_H}`,
    'WrapStyle: 0',
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

  const pctX = (p: number) => Math.round((p / 100) * DESIGN_W)

  if (preset.placement.kind === 'blocks') {
    styles.push(styleLine('RevL', preset.base, 4, pctX(preset.placement.left[0]), DESIGN_W - pctX(preset.placement.left[1]), 0))
    styles.push(styleLine('RevR', preset.base, 6, pctX(preset.placement.right[0]), DESIGN_W - pctX(preset.placement.right[1]), 0))
    // Banda vertical: dibujo \p1 — con Fontsize 64 la escala del dibujo es 1 unidad = 1 px
    const band = preset.placement
    const x0 = pctX(band.band[0])
    const x1 = pctX(band.band[1])
    const bandStyle = [
      'Style: Band',
      'Arial',
      64,
      assColor('#000000', 1),
      assColor('#FFFFFF', 1),
      assColor('#FFFFFF', band.bandAlpha),
      assColor('#000000', 1),
      0, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 7, 0, 0, 0, 1,
    ].join(',')
    styles.push(bandStyle)
    events.push(
      `Dialogue: 1,${assTime(0)},${assTime(totalDuration)},Band,,0,0,0,,{\\an7\\pos(0,0)\\p1}m ${x0} 0 l ${x1} 0 l ${x1} ${DESIGN_H} l ${x0} ${DESIGN_H}{\\p0}`
    )
    for (const cue of cues) {
      const style = cue.side === 'left' ? 'RevL' : 'RevR'
      const text = preset.emphasis
        ? cueText(cue, preset.base, preset.emphasis)
        : cue.words.map((w) => escapeAss(w.text)).filter(Boolean).join(' ')
      if (!text) continue
      events.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${style},,0,0,0,,${text}`)
    }
  } else {
    styles.push(styleLine('Main', preset.base, 5, pctX(8), pctX(8), 0))
    const y = Math.round((preset.placement.yPercent / 100) * DESIGN_H)
    for (const cue of cues) {
      const text = preset.emphasis
        ? cueText(cue, preset.base, preset.emphasis)
        : cue.words.map((w) => escapeAss(w.text)).filter(Boolean).join(' ')
      if (!text) continue
      events.push(
        `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Main,,0,0,0,,{\\an5\\pos(${Math.round(DESIGN_W / 2)},${y})}${text}`
      )
    }
  }

  return [...header, ...styles, ...events].join('\n') + '\n'
}
