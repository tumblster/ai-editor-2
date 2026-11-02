'use client'

// Línea de tiempo fluida: pistas de video, texto e imagen.
// El cabezal se actualiza por requestAnimationFrame (60 fps) tocando el DOM
// directamente — sin re-render de React por fotograma.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Playback } from '@/lib/usePlayback'
import type { CutSegment, ImageAsset, Layer, PhraseUnit, VideoAsset } from '@/types/project'

interface Props {
  videos: VideoAsset[]
  phrases: PhraseUnit[]
  segments: CutSegment[]
  imageLayers: Layer[]
  images: ImageAsset[]
  hasStyle: boolean
  playback: Playback
  onToggleUnit: (id: string) => void
  onAdjustUnit: (id: string, start: number, end: number) => void
  onImageTime: (layerId: string, start: number, end: number) => void
}

interface Item {
  unit: PhraseUnit
  left: number
  width: number
  seg?: CutSegment
}

// margen izquierdo mayor que la columna fija de etiquetas de pista (56 px),
// para que ningún clip ni marca quede tapado; margen derecho más corto
const PAD = 64
const PAD_R = 24
const MIN_BLOCK_PX = 2
const STUB_MIN_PX = 10
// Las etiquetas se muestran solo si caben enteras (nunca recortadas). Se miden
// con la misma fuente que usa el CSS de .tl-label y .tl-videoname.
const LABEL_FONT = "500 12px Inter, 'Segoe UI', system-ui, sans-serif"
const LABEL_PAD = 16 // px: 8 a cada lado
let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string): number {
  if (typeof document === 'undefined') return Infinity
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return Infinity
  measureCtx.font = LABEL_FONT
  return measureCtx.measureText(text).width
}

export default function Timeline({
  videos,
  phrases,
  segments,
  imageLayers,
  images,
  hasStyle,
  playback,
  onToggleUnit,
  onAdjustUnit,
  onImageTime,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef(new Map<string, HTMLDivElement>())
  const fittedRef = useRef(false)
  const anchorRef = useRef<{ t: number; screenX: number } | null>(null)

  const [pxPerSec, setPxPerSec] = useState(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('pref.pxPerSec') : null
    return saved ? parseFloat(saved) || 24 : 24
  })

  const videoIndex = useMemo(() => new Map(videos.map((v, i) => [v.id, i])), [videos])
  const duration = playback.duration

  const ordered = useMemo(
    () =>
      [...phrases].sort((a, b) => {
        const va = videoIndex.get(a.videoId) ?? 0
        const vb = videoIndex.get(b.videoId) ?? 0
        return va !== vb ? va - vb : a.start - b.start
      }),
    [phrases, videoIndex]
  )

  const srcTotal = useMemo(() => {
    let end = 0
    for (const u of ordered) end = Math.max(end, u.end)
    return end
  }, [ordered])

  // ---- layout secuencial: mantenidos a escala real, quitados como marcas ----
  const { items, itemByUnit, totalPx } = useMemo(() => {
    const segByUnit = new Map(segments.map((s) => [s.unitId, s]))
    const list: Item[] = []
    const byUnit = new Map<string, Item>()
    let x = PAD
    for (const unit of ordered) {
      const seg = segByUnit.get(unit.id)
      let item: Item
      if (seg) {
        const width = Math.max((seg.tlEnd - seg.tlStart) * pxPerSec, MIN_BLOCK_PX)
        item = { unit, left: x, width, seg }
      } else {
        const width = Math.max((unit.end - unit.start) * 0.3 * pxPerSec, STUB_MIN_PX)
        item = { unit, left: x, width }
      }
      list.push(item)
      byUnit.set(unit.id, item)
      x += item.width
    }
    return { items: list, itemByUnit: byUnit, totalPx: x + PAD_R }
  }, [ordered, segments, pxPerSec])

  const tlToPx = useCallback(
    (t: number) => {
      for (const s of segments) {
        if (t < s.tlEnd) {
          const item = itemByUnit.get(s.unitId)
          if (!item) continue
          return item.left + (t - s.tlStart) * pxPerSec
        }
      }
      return totalPx - PAD_R
    },
    [segments, itemByUnit, pxPerSec, totalPx]
  )

  const pxToTl = useCallback(
    (px: number) => {
      for (const item of items) {
        if (px < item.left + item.width) {
          if (item.seg) {
            return Math.min(
              Math.max(item.seg.tlStart + (px - item.left) / pxPerSec, item.seg.tlStart),
              item.seg.tlEnd
            )
          }
          // marca de quitado: salta al inicio del siguiente mantenido
          continue
        }
      }
      return duration
    },
    [items, pxPerSec, duration]
  )

  // mapeo px↔src dentro de un bloque mantenido (1:1 con pxPerSec)
  const refs = useRef({ tlToPx, pxToTl, items, pxPerSec, duration })
  refs.current = { tlToPx, pxToTl, items, pxPerSec, duration }

  // ---- ajuste inicial para encuadrar todo ----
  useEffect(() => {
    if (fittedRef.current || !scrollRef.current || !srcTotal) return
    fittedRef.current = true
    const w = scrollRef.current.clientWidth - PAD - PAD_R - 8
    const fit = Math.min(Math.max(w / srcTotal, 3), 200)
    setPxPerSec(fit)
  }, [srcTotal])

  useEffect(() => {
    window.localStorage.setItem('pref.pxPerSec', String(pxPerSec))
  }, [pxPerSec])

  // ancla del zoom: el tiempo bajo el cursor no se mueve
  useEffect(() => {
    const anchor = anchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) return
    el.scrollLeft = Math.max(0, refs.current.tlToPx(anchor.t) - anchor.screenX)
  }, [pxPerSec]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- cabezal a 60 fps ----
  useEffect(() => {
    return playback.subscribe((t) => {
      const px = refs.current.tlToPx(t)
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${px}px)`
      }
      const el = scrollRef.current
      if (playback.playing && el) {
        const view = el.scrollLeft + el.clientWidth
        if (px > view - 48 || px < el.scrollLeft) {
          el.scrollLeft = Math.max(0, px - el.clientWidth * 0.3)
        }
      }
    })
  }, [playback])

  // el layout cambió (zoom, cortes): el cabezal se recoloca sin esperar a que avance el tiempo
  useEffect(() => {
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${tlToPx(playback.getTime())}px)`
    }
  }, [tlToPx, playback])

  // ---- arrastre del cabezal ----
  const scrubbing = useRef(false)
  const onRulerDown = (e: React.PointerEvent) => {
    scrubbing.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    playback.seek(refs.current.pxToTl(px))
  }
  const onRulerMove = (e: React.PointerEvent) => {
    if (!scrubbing.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    playback.seek(refs.current.pxToTl(px))
  }
  const endScrub = () => (scrubbing.current = false)

  // ---- arrastre de bordes de clip ----
  const adjust = useRef<{
    unitId: string
    edge: 'l' | 'r'
    startX: number
    start0: number
    end0: number
    prevId?: string
    nextId?: string
    minStart: number
    maxEnd: number
    snaps: number[]
    moved: boolean
    liveStart?: number
    liveEnd?: number
  } | null>(null)

  const beginEdge = (unitId: string, edge: 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const idx = ordered.findIndex((u) => u.id === unitId)
    const unit = ordered[idx]
    const prev = ordered[idx - 1]
    const next = ordered[idx + 1]
    const snaps = new Set<number>()
    for (const w of unit.words) {
      snaps.add(w.start)
      snaps.add(w.end)
    }
    if (prev) snaps.add(prev.end)
    if (next) snaps.add(next.start)
    snaps.add(unit.start)
    snaps.add(unit.end)
    adjust.current = {
      unitId,
      edge,
      startX: e.clientX,
      start0: unit.start,
      end0: unit.end,
      prevId: prev?.id,
      nextId: next?.id,
      minStart: prev ? prev.end : 0,
      maxEnd: next ? next.start : unit.end + 30,
      snaps: [...snaps],
      moved: false,
    }
  }

  const onEdgeMove = (e: React.PointerEvent) => {
    const a = adjust.current
    if (!a) return
    const pps = refs.current.pxPerSec
    const delta = (e.clientX - a.startX) / pps
    if (Math.abs(e.clientX - a.startX) > 3) a.moved = true
    const snap = (v: number) => {
      let best = v
      let bd = 0.15
      for (const s of a.snaps) {
        const d = Math.abs(s - v)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return best
    }
    let newStart = a.start0
    let newEnd = a.end0
    if (a.edge === 'l') {
      newStart = snap(Math.min(Math.max(a.start0 + delta, a.minStart), a.end0 - 0.2))
    } else {
      newEnd = snap(Math.min(Math.max(a.end0 + delta, a.start0 + 0.2), a.maxEnd))
    }
    // actualización visual directa (sin re-render)
    const el = blocksRef.current.get(a.unitId)
    const item = refs.current.items.find((it) => it.unit.id === a.unitId)
    if (el && item) {
      const left = item.left + (newStart - a.start0) * pps
      const width = Math.max((newEnd - newStart) * pps, MIN_BLOCK_PX)
      el.style.left = `${left}px`
      el.style.width = `${width}px`
    }
    const grow = (id: string | undefined, prop: 'left' | 'width', deltaPx: number) => {
      if (!id) return
      const nel = blocksRef.current.get(id)
      if (!nel) return
      const cur = parseFloat(nel.style[prop] || '0')
      nel.style[prop] = `${Math.max(cur + deltaPx, MIN_BLOCK_PX)}px`
    }
    if (a.prevId) grow(a.prevId, 'width', (a.start0 - newStart) * pps)
    if (a.nextId) {
      const nel = blocksRef.current.get(a.nextId)
      const nItem = refs.current.items.find((it) => it.unit.id === a.nextId)
      if (nel && nItem) {
        nel.style.left = `${nItem.left + (newEnd - a.end0) * pps}px`
      }
    }
    a.liveStart = newStart
    a.liveEnd = newEnd
  }

  const onEdgeUp = () => {
    const a = adjust.current
    adjust.current = null
    if (!a) return
    if (a.moved && a.liveStart !== undefined && a.liveEnd !== undefined) {
      onAdjustUnit(a.unitId, a.liveStart, a.liveEnd)
    }
  }

  // ---- clips de imagen: mover en tiempo / ajustar duración ----
  const imgDrag = useRef<{
    layerId: string
    mode: 'move' | 'l' | 'r'
    startX: number
    start: number
    end: number
    moved: boolean
  } | null>(null)
  const [imgLive, setImgLive] = useState<{ id: string; deltaL: number; deltaR: number } | null>(null)

  const beginImg = (layerId: string, mode: 'move' | 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const layer = imageLayers.find((l) => l.id === layerId)
    if (!layer) return
    imgDrag.current = { layerId, mode, startX: e.clientX, start: layer.start, end: layer.end, moved: false }
  }

  const imgLast = useRef<{ dL: number; dR: number }>({ dL: 0, dR: 0 })

  const onImgMove = (e: React.PointerEvent) => {
    const d = imgDrag.current
    if (!d) return
    const delta = (e.clientX - d.startX) / refs.current.pxPerSec
    if (Math.abs(e.clientX - d.startX) > 3) d.moved = true
    const dL = d.mode === 'r' ? 0 : delta
    const dR = d.mode === 'l' ? 0 : delta
    imgLast.current = { dL, dR }
    setImgLive({ id: d.layerId, deltaL: dL, deltaR: dR })
  }

  const onImgUp = () => {
    const d = imgDrag.current
    imgDrag.current = null
    setImgLive(null)
    if (!d || !d.moved) return
    const { dL, dR } = imgLast.current
    const minDur = 0.5
    if (d.mode === 'move') {
      onImageTime(d.layerId, Math.max(0, d.start + dL), Math.min(duration, d.end + dR))
    } else if (d.mode === 'l') {
      onImageTime(d.layerId, Math.min(d.start + dL, d.end - minDur), d.end)
    } else {
      onImageTime(d.layerId, d.start, Math.max(d.end + dR, d.start + minDur))
    }
  }

  // ---- regla ----
  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    const step = steps.find((s) => s * pxPerSec >= 72) ?? 900
    const out: number[] = []
    // solo marcas dentro de la duración: las de más allá se encimaban al final
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(t)
    return out
  }, [pxPerSec, duration])

  // ---- franjas por video ----
  const videoSpans = useMemo(() => {
    const spans: { index: number; name: string; left: number; right: number }[] = []
    for (let i = 0; i < items.length; i++) {
      const vi = videoIndex.get(items[i].unit.videoId) ?? 0
      const last = spans[spans.length - 1]
      if (!last || last.index !== vi) {
        spans.push({ index: vi, name: videos[vi]?.name ?? `Video ${vi + 1}`, left: items[i].left, right: items[i].left + items[i].width })
      } else {
        last.right = items[i].left + items[i].width
      }
    }
    return spans
  }, [items, videoIndex, videos])

  const urlBySrc = new Map(images.map((img) => [img.id, img.url]))

  return (
    <div
      className="tl-scroll"
      ref={scrollRef}
      onWheel={(e) => {
        if (e.shiftKey) return
        e.preventDefault()
        const el = scrollRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const screenX = e.clientX - rect.left
        anchorRef.current = { t: refs.current.pxToTl(el.scrollLeft + screenX), screenX }
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18
        setPxPerSec((p) => Math.min(Math.max(p * factor, 2), 400))
      }}
    >
      <div className="tl-inner" style={{ width: totalPx }}>
        {/* regla */}
        <div
          className="tl-ruler"
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          {ticks.map((t) => (
            <span key={t} className="tl-tick" style={{ left: tlToPx(t) }}>
              <i />
              {Math.floor(t / 60)}:{Math.floor(t % 60).toString().padStart(2, '0')}
            </span>
          ))}
        </div>

        {/* franja de nombres de video */}
        <div className="tl-videolane">
          {videoSpans.map((s) => (
            textWidth(s.name) + LABEL_PAD <= s.right - s.left ? (
              <span key={s.index} className="tl-videoname" style={{ left: s.left }} title={s.name}>
                {s.name}
              </span>
            ) : null
          ))}
        </div>

        {/* pista de video */}
        <div className="tl-track tl-track-video">
          <span className="tl-track-label">Video</span>
          {items.map((item) => {
            const { unit } = item
            const removed = unit.removed
            const labelFits = item.width >= textWidth(unit.text) + LABEL_PAD
            return (
              <div
                key={unit.id}
                ref={(el) => {
                  if (el) blocksRef.current.set(unit.id, el)
                  else blocksRef.current.delete(unit.id)
                }}
                className={`tl-clip ${removed ? 'is-removed' : unit.kind === 'gap' ? 'is-gap' : 'is-phrase'}`}
                style={{ left: item.left, width: item.width }}
                title={`${unit.kind === 'gap' ? 'silencio' : unit.text}${removed ? ' — quitado' : ''}`}
                onClick={() => {
                  const a = adjust.current
                  if (a?.moved) return
                  onToggleUnit(unit.id)
                }}
                onPointerMove={onEdgeMove}
                onPointerUp={onEdgeUp}
                onPointerCancel={onEdgeUp}
              >
                {removed ? (
                  <span className="tl-restore">↺</span>
                ) : (
                  <>
                    {labelFits && unit.kind === 'phrase' && <span className="tl-label">{unit.text}</span>}
                    <span className="tl-edge tl-edge-l" onPointerDown={beginEdge(unit.id, 'l')} />
                    <span className="tl-edge tl-edge-r" onPointerDown={beginEdge(unit.id, 'r')} />
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* pista de texto */}
        <div className="tl-track tl-track-text">
          <span className="tl-track-label">Texto</span>
          {hasStyle &&
            items
              .filter((it) => it.seg && it.unit.kind === 'phrase')
              .map((it) => (
                <div key={it.unit.id} className="tl-textbar" style={{ left: it.left, width: Math.max(it.width - 1, 2) }} />
              ))}
        </div>

        {/* pista de imagen */}
        <div className="tl-track tl-track-image">
          <span className="tl-track-label">Imagen</span>
          {imageLayers.map((layer) => {
            const live = imgLive?.id === layer.id ? imgLive : null
            const start = Math.max(0, layer.start + (live?.deltaL ?? 0))
            const end = Math.min(duration, layer.end + (live?.deltaR ?? 0))
            const left = tlToPx(start)
            const width = Math.max(tlToPx(end) - left, 6)
            const url = layer.src ? urlBySrc.get(layer.src) : undefined
            return (
              <div
                key={layer.id}
                className={`tl-imgclip ${layer.enabled === false ? 'is-off' : ''}`}
                style={{ left, width }}
                onPointerDown={beginImg(layer.id, 'move')}
                onPointerMove={onImgMove}
                onPointerUp={onImgUp}
                onPointerCancel={onImgUp}
              >
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" draggable={false} />
                )}
                <span className="tl-edge tl-edge-l" onPointerDown={beginImg(layer.id, 'l')} />
                <span className="tl-edge tl-edge-r" onPointerDown={beginImg(layer.id, 'r')} />
              </div>
            )
          })}
        </div>

        {/* cabezal */}
        <div ref={playheadRef} className="tl-playhead">
          <i />
        </div>
      </div>
    </div>
  )
}
