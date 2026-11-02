'use client'

// Reproductor con el aspecto del video subido (9:16 en reels verticales). La
// superposición de estilo e imágenes vive en un lienzo del mismo tamaño que el
// MP4 (lado corto 1080 px), escalado — la misma escala y posición que el export.

import { useEffect, useRef, useState } from 'react'

import { CaptionRender } from './CaptionRender'
import { activeCue, type Cue } from '@/lib/cues'
import type { Canvas } from '@/lib/canvas'
import { clampOffset, cueHitsImage, textRect, type TextOffset } from '@/lib/textLayout'
import type { StylePreset } from '@/lib/styles/presets'
import type { Playback } from '@/lib/usePlayback'
import { formatTime } from '@/lib/timeline'
import type { ImageAsset, Layer, VideoAsset } from '@/types/project'

interface Props {
  canvas: Canvas
  videos: VideoAsset[]
  images: ImageAsset[]
  imageLayers: Layer[]
  stylePreset: StylePreset | null
  cues: Cue[]
  playback: Playback
  onImagePatch: (layerId: string, patch: Partial<Layer>) => void
  textOffset: TextOffset
  onTextMove: (offset: TextOffset) => void
}

function CaptionLive({
  preset,
  cues,
  playback,
  canvas,
  scale,
  offset,
  imageLayers,
  onMove,
}: {
  preset: StylePreset
  cues: Cue[]
  playback: Playback
  canvas: Canvas
  scale: number
  offset: TextOffset
  imageLayers: Layer[]
  onMove: (offset: TextOffset) => void
}) {
  const [cue, setCue] = useState<Cue | null>(null)
  const idRef = useRef<string | null>(null)
  // arrastre del bloque de texto completo, como las imágenes
  const [live, setLive] = useState<TextOffset | null>(null)
  const liveRef = useRef<TextOffset | null>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number; id: number } | null>(null)

  useEffect(() => {
    return playback.subscribe((t) => {
      const c = activeCue(cues, t)
      const cid = c?.id ?? null
      if (cid !== idRef.current) {
        idRef.current = cid
        setCue(c)
      }
    })
  }, [playback, cues])

  const shown = live ?? offset
  const collision = cue ? cueHitsImage(cue, textRect(preset, cue.side, shown, canvas), imageLayers) : false

  const onDragStart = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: offset.x, y: offset.y, id: e.pointerId }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      const next = clampOffset({
        x: d.x + ((e.clientX - d.px) / (canvas.w * scale)) * 100,
        y: d.y + ((e.clientY - d.py) / (canvas.h * scale)) * 100,
      })
      liveRef.current = next
      setLive(next)
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      drag.current = null
      const moved = liveRef.current
      liveRef.current = null
      setLive(null)
      if (moved) onMove(moved)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [canvas.w, canvas.h, scale, onMove])

  return (
    <CaptionRender preset={preset} cue={cue} offset={shown} collision={collision} onDragStart={onDragStart} />
  )
}

function ImageBlock({
  layer,
  url,
  scale,
  canvas,
  onPatch,
}: {
  layer: Layer
  url: string
  scale: number
  canvas: Canvas
  onPatch: (layerId: string, patch: Partial<Layer>) => void
}) {
  const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const drag = useRef<{
    mode: 'move' | 'resize'
    px: number
    py: number
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const geo = live ?? {
    x: layer.x ?? 50,
    y: layer.y ?? 78,
    width: layer.width ?? 40,
    height: layer.height ?? 21,
  }

  const onPointerDown = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = {
      mode,
      px: e.clientX,
      py: e.clientY,
      x: layer.x ?? 50,
      y: layer.y ?? 78,
      w: layer.width ?? 40,
      h: layer.height ?? 21,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dxPct = ((e.clientX - d.px) / (canvas.w * scale)) * 100
    const dyPct = ((e.clientY - d.py) / (canvas.h * scale)) * 100
    if (d.mode === 'move') {
      setLive({
        x: Math.min(Math.max(d.x + dxPct, d.w / 2), 100 - d.w / 2),
        y: Math.min(Math.max(d.y + dyPct, d.h / 2), 100 - d.h / 2),
        width: d.w,
        height: d.h,
      })
    } else {
      const w = Math.min(Math.max(d.w + dxPct * 2, 6), 100)
      const h = Math.min(Math.max(d.h + dyPct * 2, 4), 100)
      setLive({ x: d.x, y: d.y, width: w, height: h })
    }
  }

  const onPointerUp = () => {
    if (drag.current && live) onPatch(layer.id, live)
    drag.current = null
    setLive(null)
  }

  return (
    <div
      className="image-block"
      style={{
        left: `${geo.x - geo.width / 2}%`,
        top: `${geo.y - geo.height / 2}%`,
        width: `${geo.width}%`,
        height: `${geo.height}%`,
      }}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" draggable={false} />
      <span
        className="image-handle"
        onPointerDown={onPointerDown('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}

export default function PreviewPlayer({
  canvas,
  videos,
  images,
  imageLayers,
  stylePreset,
  cues,
  playback,
  onImagePatch,
  textOffset,
  onTextMove,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  // tamaño en pantalla del reproductor: el mayor que cabe con el aspecto del lienzo
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => {
      const k = Math.min(el.clientWidth / canvas.w, el.clientHeight / canvas.h)
      setSize({ w: Math.floor(canvas.w * k), h: Math.floor(canvas.h * k) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvas.w, canvas.h])
  const scale = size.w ? size.w / canvas.w : 0.2

  useEffect(() => {
    return playback.subscribe((t) => {
      if (timeRef.current) {
        timeRef.current.textContent = `${formatTime(t)} / ${formatTime(playback.duration)}`
      }
    })
  }, [playback])

  const urlBySrc = new Map(images.map((img) => [img.id, img.url]))

  return (
    <div className="player-col">
      <div ref={boxRef} className="playfield-box">
      <div
        className="playfield"
        style={{ width: size.w, height: size.h }}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO') {
            playback.toggle()
          }
        }}
      >
        {videos.map((v, i) => (
          <video
            key={v.id}
            ref={(el) => playback.registerVideo(i, el)}
            src={v.url}
            preload="auto"
            playsInline
            style={{ opacity: i === 0 ? 1 : 0 }}
          />
        ))}
        <div
          className="overlay-canvas"
          style={{
            width: canvas.w,
            height: canvas.h,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          {imageLayers
            .filter((l) => l.enabled !== false)
            .map((l) => {
              const url = l.src ? urlBySrc.get(l.src) : undefined
              if (!url) return null
              return (
                <ImageBlock key={l.id} layer={l} url={url} scale={scale} canvas={canvas} onPatch={onImagePatch} />
              )
            })}
          {/* el texto va encima de las imágenes, igual que en el export */}
          {stylePreset && (
            <CaptionLive
              preset={stylePreset}
              cues={cues}
              playback={playback}
              canvas={canvas}
              scale={scale}
              offset={textOffset}
              imageLayers={imageLayers}
              onMove={onTextMove}
            />
          )}
        </div>
      </div>
      </div>

      <div className="player-controls">
        <button type="button" className="icon-btn" onClick={playback.toggle} aria-label="Play">
          {playback.playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M8 5l12 7-12 7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span ref={timeRef} className="time-label">
          0:00 / {formatTime(playback.duration)}
        </span>
      </div>
    </div>
  )
}
