// Mapeos entre tiempo fuente (cada video) y tiempo de línea de tiempo (= tiempo de export).
// Puro y compartido: lo usan preview, timeline y export.

import type { CutSegment, PhraseUnit, VideoAsset } from '@/types/project'

/**
 * Segmentos mantenidos, en orden de video y de tiempo — la lista de cortes.
 * Si se conoce la duración real del video, cada segmento se recorta a ella:
 * una unidad no puede durar más que los fotogramas que existen (si no, la
 * línea de tiempo, los subtítulos y el export se desfasan).
 * Los bordes se alinean a la rejilla de fotogramas del original: así cada
 * segmento dura exactamente sus fotogramas y el tiempo de la línea de tiempo
 * (preview, subtítulos, imágenes) coincide con el MP4 sin desfase acumulado.
 */
export const DEFAULT_FPS = 30

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps
}

export function buildCutSegments(
  videos: (Pick<VideoAsset, 'id'> & { duration?: number; fps?: number })[],
  phrases: PhraseUnit[]
): CutSegment[] {
  const videoIndex = new Map(videos.map((v, i) => [v.id, i]))
  const metaById = new Map(
    videos.map((v) => [
      v.id,
      {
        max: v.duration && v.duration > 0 ? v.duration : Infinity,
        fps: v.fps && v.fps > 0 ? v.fps : DEFAULT_FPS,
      },
    ])
  )
  const clampUnit = (p: PhraseUnit) => {
    const meta = metaById.get(p.videoId) ?? { max: Infinity, fps: DEFAULT_FPS }
    // el último fotograma completo dentro de la duración real
    const lastEdge = Number.isFinite(meta.max) ? Math.floor(meta.max * meta.fps + 1e-6) / meta.fps : Infinity
    const start = Math.min(snapToFrame(p.start, meta.fps), lastEdge)
    const end = Math.min(snapToFrame(p.end, meta.fps), lastEdge)
    return { start, end }
  }
  const kept = phrases
    .filter((p) => {
      if (p.removed) return false
      const c = clampUnit(p)
      return c.end - c.start > 1e-6
    })
    .filter((p) => videoIndex.has(p.videoId))
    .sort((a, b) => {
      const va = videoIndex.get(a.videoId) ?? 0
      const vb = videoIndex.get(b.videoId) ?? 0
      return va !== vb ? va - vb : a.start - b.start
    })

  const segments: CutSegment[] = []
  let tl = 0
  for (const u of kept) {
    const { start, end } = clampUnit(u)
    segments.push({
      unitId: u.id,
      videoId: u.videoId,
      videoIndex: videoIndex.get(u.videoId) ?? 0,
      srcStart: start,
      srcEnd: end,
      tlStart: tl,
      tlEnd: tl + (end - start),
    })
    tl += end - start
  }
  return segments
}

export function totalDuration(segments: CutSegment[]): number {
  return segments.length ? segments[segments.length - 1].tlEnd : 0
}

/** Segmento activo en el tiempo t de la línea de tiempo. */
export function segmentAt(segments: CutSegment[], t: number): CutSegment | null {
  if (!segments.length) return null
  if (t < 0) t = 0
  for (let i = 0; i < segments.length; i++) {
    if (t < segments[i].tlEnd || i === segments.length - 1) return segments[i]
  }
  return null
}

/** Tiempo fuente del video que se reproduce en el tiempo t de la línea de tiempo. */
export function timelineToSrc(segments: CutSegment[], t: number): { videoIndex: number; srcTime: number; seg: CutSegment } | null {
  const seg = segmentAt(segments, t)
  if (!seg) return null
  const local = Math.min(Math.max(t - seg.tlStart, 0), seg.tlEnd - seg.tlStart)
  return { videoIndex: seg.videoIndex, srcTime: seg.srcStart + local, seg }
}

/** Tiempo de línea de tiempo de un tiempo fuente concreto (fuera de segmentos → límite más cercano). */
export function srcToTimeline(segments: CutSegment[], videoId: string, srcTime: number): number {
  for (const s of segments) {
    if (s.videoId !== videoId) continue
    if (srcTime < s.srcStart) return s.tlStart
    if (srcTime <= s.srcEnd) return s.tlStart + (srcTime - s.srcStart)
  }
  // después del último segmento del video → fin del siguiente segmento en la línea
  const after = segments.find((s) => s.videoId === videoId && s.srcStart > srcTime)
  return after ? after.tlStart : totalDuration(segments)
}

export function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s))
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
