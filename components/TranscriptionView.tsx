'use client'

// Vista de transcripción: frases de 3-5 palabras en orden, sincronizadas,
// cada una quitable/restaurable. Sigue la reproducción con resaltado.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { Playback } from '@/lib/usePlayback'
import type { CutSegment, PhraseUnit, VideoAsset } from '@/types/project'

interface Props {
  videos: VideoAsset[]
  phrases: PhraseUnit[]
  segments: CutSegment[]
  playback: Playback
  onToggle: (id: string) => void
}

export default function TranscriptionView({ videos, phrases, segments, playback, onToggle }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const chipRefs = useRef(new Map<string, HTMLDivElement>())

  const tlStartByUnit = useMemo(
    () => new Map(segments.map((s) => [s.unitId, s.tlStart])),
    [segments]
  )

  useEffect(() => {
    return playback.subscribe((t) => {
      let current: string | null = null
      for (const s of segments) {
        if (t < s.tlEnd) {
          current = s.unitId
          break
        }
      }
      if (current !== activeId) {
        setActiveId(current)
        if (current && playback.playing) {
          chipRefs.current.get(current)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }
    })
  }, [playback, segments, activeId])

  const videoIndex = useMemo(() => new Map(videos.map((v, i) => [v.id, i])), [videos])
  const grouped = useMemo(() => {
    const byVideo = new Map<string, PhraseUnit[]>()
    for (const p of phrases) {
      if (p.kind !== 'phrase') continue
      const list = byVideo.get(p.videoId) ?? []
      list.push(p)
      byVideo.set(p.videoId, list)
    }
    return [...byVideo.entries()].sort(
      (a, b) => (videoIndex.get(a[0]) ?? 0) - (videoIndex.get(b[0]) ?? 0)
    )
  }, [phrases, videoIndex])

  return (
    <div className="transcription">
      {grouped.map(([videoId, units]) => (
        <div key={videoId} className="transcription-video">
          <span className="transcription-vname" title={videos.find((v) => v.id === videoId)?.name}>
            {videos.find((v) => v.id === videoId)?.name ?? 'Video'}
          </span>
          <div className="transcription-chips">
            {units.map((u) => {
              const tl = tlStartByUnit.get(u.id)
              return (
                <div
                  key={u.id}
                  ref={(el) => {
                    if (el) chipRefs.current.set(u.id, el)
                    else chipRefs.current.delete(u.id)
                  }}
                  className={`chip ${u.removed ? 'chip-removed' : ''} ${
                    activeId === u.id ? 'chip-active' : ''
                  }`}
                  onClick={() => {
                    if (!u.removed && tl !== undefined) playback.seek(tl + 0.01)
                  }}
                >
                  <span className="chip-text">{u.text}</span>
                  {u.removed ? (
                    <button
                      type="button"
                      className="btn btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(u.id)
                      }}
                    >
                      Restaurar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn chip-x"
                      aria-label="Quitar"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(u.id)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
