'use client'

// Selector de estilo con layout de tarjetas: la preview es el reproductor (a la
// izquierda en escritorio, arriba en móvil); aquí van los pasos arriba, las
// tarjetas y Back / Next abajo. Cada tarjeta repite el mismo fotograma del clip
// con un estilo distinto aplicado, con el aspecto del video.

import { useEffect, useMemo, useRef, useState } from 'react'

import { CaptionRender, EXAMPLE_WORDS } from './CaptionRender'
import type { Canvas } from '@/lib/canvas'
import { markEmph, type Cue } from '@/lib/cues'
import { STYLE_PRESETS, STYLE_IDS, resolveStyle } from '@/lib/styles/presets'
import type { CutSegment, PhraseUnit, StylePresetId, VideoAsset } from '@/types/project'

interface Props {
  styleId: StylePresetId | null
  onSelect: (id: StylePresetId | null) => void
  outline: boolean
  outlines: Partial<Record<StylePresetId, boolean>>
  onOutline: (on: boolean) => void
  contrastIssue: boolean
  canvas: Canvas
  videos: VideoAsset[]
  phrases: PhraseUnit[]
  segments: CutSegment[]
}

/** Primera frase mantenida: de ella salen el fotograma y el texto de las tarjetas. */
function firstPhrase(phrases: PhraseUnit[], segments: CutSegment[]) {
  const byId = new Map(phrases.map((p) => [p.id, p]))
  for (const seg of segments) {
    const u = byId.get(seg.unitId)
    if (u && u.kind === 'phrase' && u.words.length) return { seg, words: u.words.map((w) => w.word.trim()) }
  }
  return null
}

/** Captura un fotograma del clip (mismo origen: /api/files) como imagen. */
function useClipFrame(url: string | undefined, time: number): string | null {
  const [frame, setFrame] = useState<string | null>(null)
  useEffect(() => {
    if (!url) return
    let alive = true
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.playsInline = true
    const onLoaded = () => {
      v.currentTime = Math.max(0, time)
    }
    const onSeeked = () => {
      if (!alive || !v.videoWidth) return
      const k = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(v.videoWidth * k)
      c.height = Math.round(v.videoHeight * k)
      const ctx = c.getContext('2d')
      if (!ctx) return
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height)
        setFrame(c.toDataURL('image/jpeg', 0.82))
      } catch {
        /* sin fotograma: la tarjeta queda con fondo liso */
      }
    }
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('seeked', onSeeked)
    v.src = url
    return () => {
      alive = false
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('seeked', onSeeked)
      v.removeAttribute('src')
      v.load()
    }
  }, [url, time])
  return frame
}

function cueFor(id: StylePresetId, words: string[]): Cue {
  const preset = STYLE_PRESETS[id]
  const texts = words.slice(0, Math.max(1, preset.cueWords))
  const emph = preset.emphasis ? markEmph(preset.emphasis.scope, texts) : texts.map(() => false)
  return { id: `card-${id}`, start: 0, end: 1, words: texts.map((text, i) => ({ text, emph: emph[i] })), side: 'left' }
}

/** Fotograma del clip + estilo, en el lienzo del proyecto escalado al ancho de la tarjeta. */
function CardThumb({
  id,
  outline,
  canvas,
  frame,
  words,
}: {
  id: StylePresetId
  outline: boolean
  canvas: Canvas
  frame: string | null
  words: string[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(el.clientWidth / canvas.w)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvas.w])
  const preset = useMemo(() => resolveStyle(STYLE_PRESETS[id], { outline }), [id, outline])
  const cue = useMemo(() => cueFor(id, words), [id, words])
  return (
    <div ref={ref} className="style-thumb" style={{ aspectRatio: `${canvas.w} / ${canvas.h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {frame && <img className="style-thumb-frame" src={frame} alt="" draggable={false} />}
      {scale > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: canvas.w,
            height: canvas.h,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <CaptionRender preset={preset} cue={cue} />
        </div>
      )}
    </div>
  )
}

export default function StylePicker({
  styleId,
  onSelect,
  outline,
  outlines,
  onOutline,
  contrastIssue,
  canvas,
  videos,
  phrases,
  segments,
}: Props) {
  const ids = STYLE_IDS
  const currentIdx = styleId ? ids.indexOf(styleId) : -1

  const step = (dir: 1 | -1) => {
    // ciclo: -1 (ninguno) → 0 → … → 4 → -1
    const raw = currentIdx + dir
    if (raw >= ids.length) onSelect(null)
    else if (raw < -1) onSelect(ids[ids.length - 1])
    else onSelect(raw === -1 ? null : ids[raw])
  }

  // mismo fotograma y misma frase en todas las tarjetas
  const sample = useMemo(() => firstPhrase(phrases, segments), [phrases, segments])
  const video = sample ? videos[sample.seg.videoIndex] : videos[0]
  const t = sample ? sample.seg.srcStart + Math.min(0.4, (sample.seg.srcEnd - sample.seg.srcStart) / 2) : 0
  const frame = useClipFrame(video?.url, Math.round(t * 100) / 100)
  const words = sample?.words ?? EXAMPLE_WORDS

  return (
    <div className="style-picker">
      <ol className="style-steps" aria-hidden>
        {ids.map((id, i) => (
          <li key={id} className={i === currentIdx ? 'is-current' : ''} />
        ))}
      </ol>

      <div className="style-cards">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            className={`style-card ${styleId === id ? 'is-selected' : ''}`}
            aria-pressed={styleId === id}
            onClick={() => onSelect(styleId === id ? null : id)}
          >
            <CardThumb id={id} outline={!!outlines[id]} canvas={canvas} frame={frame} words={words} />
            <span className="style-card-name">{STYLE_PRESETS[id].name}</span>
          </button>
        ))}
      </div>

      <div className="style-options">
        <label className="check">
          <input
            type="checkbox"
            checked={outline}
            disabled={!styleId}
            onChange={(e) => onOutline(e.target.checked)}
          />
          <span>Contorno</span>
        </label>
        {contrastIssue && (
          <span
            className="contrast-warn"
            role="img"
            aria-label="Revisa el contraste del texto contra el video"
            title="Revisa el contraste del texto contra el video"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M12 3 2 20h20L12 3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="17" r="1.2" fill="currentColor" />
            </svg>
          </span>
        )}
      </div>

      <div className="style-nav">
        <button type="button" className="btn btn-ghost" onClick={() => step(-1)}>
          Back
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => step(1)}>
          Next
        </button>
      </div>
    </div>
  )
}
