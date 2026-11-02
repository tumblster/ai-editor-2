// Cues de subtítulos: cómo se agrupa y resalta el texto quemado según el estilo.
// Compartido entre preview (client) y export (server) para que coincidan.

import type { CutSegment, GroqWord, PhraseUnit, StylePresetId } from '@/types/project'
import { STYLE_PRESETS } from './styles/presets'

export interface CueWord {
  text: string
  emph: boolean
}

export interface Cue {
  id: string
  start: number // tiempo de línea de tiempo (= export)
  end: number
  words: CueWord[]
  side: 'left' | 'right' // solo Revista alterna bloques
}

const STOPWORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'una',
  'para', 'con', 'no', 'su', 'al', 'lo', 'como', 'más', 'mas', 'pero', 'le', 'ya', 'o',
  'sus', 'me', 'mi', 'te', 'esta', 'este', 'esto', 'ese', 'eso', 'son', 'fue', 'era',
  'muy', 'también', 'tambien', 'así', 'asi', 'hacer', 'tiene', 'puedo', 'puede', 'vamos',
  'siento', 'nada', 'todo', 'todos',
])

export function isNumberWord(text: string): boolean {
  return /[\d%€$]|(?:mil|milón|millon|millón|millones)/i.test(text)
}

function keywordIndex(texts: string[]): number {
  let best = -1
  let bestScore = 0
  texts.forEach((t, i) => {
    const clean = t.replace(/[^\p{L}\p{N}%€$]/gu, '')
    if (!clean) return
    const score = clean.length + (STOPWORDS.has(clean.toLowerCase()) ? -100 : 0)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

/** Qué palabras van destacadas según el scope del énfasis (keyword o números). */
export function markEmph(scope: 'keyword' | 'numbers', texts: string[]): boolean[] {
  if (scope === 'numbers') return texts.map((t) => isNumberWord(t))
  const kIdx = keywordIndex(texts)
  return texts.map((_, i) => i === kIdx)
}

function isEmph(scope: 'keyword' | 'numbers', texts: string[], i: number, kIdx: number): boolean {
  if (scope === 'numbers') return isNumberWord(texts[i])
  return i === kIdx
}

export function buildCues(
  styleId: StylePresetId,
  phrases: PhraseUnit[],
  segments: CutSegment[]
): Cue[] {
  const preset = STYLE_PRESETS[styleId]
  const byId = new Map(phrases.map((p) => [p.id, p]))
  const cues: Cue[] = []
  let flip = 0

  for (const seg of segments) {
    const unit = byId.get(seg.unitId)
    if (!unit || unit.kind !== 'phrase' || !unit.words.length) continue
    const remap = (t: number) => seg.tlStart + (t - seg.srcStart)

    const chunks: GroqWord[][] = []
    const step = Math.max(1, preset.cueWords)
    for (let i = 0; i < unit.words.length; i += step) chunks.push(unit.words.slice(i, i + step))

    chunks.forEach((chunk, ci) => {
      const texts = chunk.map((w) => w.word.trim())
      const kIdx = keywordIndex(texts)
      const words: CueWord[] = texts.map((text, i) => ({
        text,
        emph: preset.emphasis ? isEmph(preset.emphasis.scope, texts, i, kIdx) : false,
      }))
      // primer cue desde el inicio del segmento y último hasta su fin: sin huecos
      // ni solapes con los segmentos vecinos (bordes alineados a fotograma)
      const start = ci === 0 ? seg.tlStart : Math.max(seg.tlStart, remap(chunk[0].start))
      const end =
        ci === chunks.length - 1
          ? seg.tlEnd
          : Math.min(seg.tlEnd, remap(chunks[ci + 1][0].start))
      // palabras que caen después del fin real del video (segmento recortado)
      if (end - start <= 1e-6) return
      cues.push({
        id: `${unit.id}-c${ci}`,
        start,
        end,
        words,
        side: flip++ % 2 === 0 ? 'left' : 'right',
      })
    })
  }
  return cues
}

/**
 * Cue visible en t: intervalo semiabierto [inicio, fin), igual que libass en el
 * export. Sin tolerancias: en la frontera entre dos cues se ve el siguiente,
 * como en el MP4.
 */
export function activeCue(cues: Cue[], t: number): Cue | null {
  for (const c of cues) {
    if (t >= c.start && t < c.end) return c
  }
  return null
}
