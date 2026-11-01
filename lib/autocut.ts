// Autorrecorte — corre en el navegador sobre el JSON de transcripción.
// No destructivo: solo marca unidades como removed; el original nunca se toca.

import type { PhraseUnit } from '@/types/project'
import { normalizeWord } from './phrases'

export interface AutocutOptions {
  silences: boolean
  fillers: boolean
  retakes: boolean
}

export interface AutocutSummary {
  seconds: number
  silences: number
  fillers: number
  retakes: number
}

const SILENCE_MIN = 0.5 // s: los silencios >= esto se quitan
const RETAKE_WINDOW = 30 // s: distancia máxima entre intentos repetidos
const RETAKE_MIN_WORDS = 2 // una repetión de 1 palabra no cuenta (falsos positivos)

/** Resetea los cortes previos y aplica las detecciones activadas. */
export function applyAutocut(
  phrases: PhraseUnit[],
  opts: AutocutOptions
): { phrases: PhraseUnit[]; summary: AutocutSummary } {
  const out: PhraseUnit[] = phrases.map((p) => ({
    ...p,
    words: p.words,
    removed: false,
    reason: undefined,
  }))

  if (opts.silences) {
    for (const p of out) {
      if (p.kind === 'gap' && p.end - p.start >= SILENCE_MIN) {
        p.removed = true
        p.reason = 'silence'
      }
    }
  }

  if (opts.fillers) {
    for (const p of out) {
      if (p.kind === 'phrase' && p.isFiller) {
        p.removed = true
        p.reason = 'filler'
      }
    }
  }

  if (opts.retakes) {
    detectRetakes(out)
  }

  const summary: AutocutSummary = { seconds: 0, silences: 0, fillers: 0, retakes: 0 }
  for (const p of out) {
    if (!p.removed) continue
    summary.seconds += p.end - p.start
    if (p.reason === 'silence') summary.silences++
    else if (p.reason === 'filler') summary.fillers++
    else if (p.reason === 'retake') summary.retakes++
  }
  return { phrases: out, summary }
}

/**
 * Retakes: frases repetidas — se queda solo el último intento completo.
 * Conservador: texto normalizado idéntico (1-3 frases seguidas), dentro de la
 * ventana de tiempo, y el intento anterior termina en pausa o muletilla.
 */
function detectRetakes(phrases: PhraseUnit[]): void {
  const speakable = phrases.filter(
    (p) => p.kind === 'phrase' && !p.isFiller && p.words.filter((w) => normalizeWord(w.word)).length >= RETAKE_MIN_WORDS
  )

  const normText = (p: PhraseUnit) =>
    p.words.map((w) => normalizeWord(w.word)).filter(Boolean).join(' ')

  const used = new Set<string>()
  for (let a = 0; a < speakable.length; a++) {
    if (used.has(speakable[a].id)) continue
    for (let n = 3; n >= 1; n--) {
      const runA = speakable.slice(a, a + n)
      if (runA.length < n) continue
      const textA = runA.map(normText).join(' ')
      if (textA.split(' ').length < RETAKE_MIN_WORDS) continue
      const lastA = runA[runA.length - 1]

      // el intento fallido termina en pausa (gap), muletilla o fin del video
      const nextUnit = phrases
        .filter((p) => p.videoId === lastA.videoId && p.start >= lastA.end - 0.01)
        .sort((x, y) => x.start - y.start)[0]
      const endsAbandoned = !nextUnit || nextUnit.kind === 'gap' || nextUnit.isFiller === true
      if (!endsAbandoned) continue

      for (let b = a + n; b < speakable.length; b++) {
        const runB = speakable.slice(b, b + n)
        if (runB.length < n) break
        if (runB[0].videoId !== runA[0].videoId) break
        if (runB[0].start - lastA.end > RETAKE_WINDOW) break
        if (runB.some((p) => used.has(p.id))) continue
        const textB = runB.map(normText).join(' ')
        if (textA !== textB || !textA) continue
        // se queda el último intento: se marca el anterior
        for (const p of runA) {
          const target = phrases.find((x) => x.id === p.id)
          if (target) {
            target.removed = true
            target.reason = 'retake'
          }
          used.add(p.id)
        }
        break
      }
    }
  }
}

/** Resumen exacto: Se quitaron X segundos — Y silencios · Z muletillas · W retakes (omite ceros). */
export function formatSummary(s: AutocutSummary): string {
  const parts: string[] = []
  if (s.silences > 0) parts.push(`${s.silences} silencios`)
  if (s.fillers > 0) parts.push(`${s.fillers} muletillas`)
  if (s.retakes > 0) parts.push(`${s.retakes} retakes`)
  const secs = Math.max(Math.round(s.seconds), 0)
  if (parts.length === 0) return `Se quitaron ${secs} segundos`
  return `Se quitaron ${secs} segundos — ${parts.join(' · ')}`
}
