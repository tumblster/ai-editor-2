'use client'

// Pantalla principal: primera pantalla de subida + editor.
// Estados: vacío · cargando subida · cargando transcripción · éxito · error.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import AutocutPanel from '@/components/AutocutPanel'
import ExportButton from '@/components/ExportButton'
import ImagesPanel from '@/components/ImagesPanel'
import PreviewPlayer from '@/components/PreviewPlayer'
import StylePicker from '@/components/StylePicker'
import Timeline from '@/components/Timeline'
import TranscriptionView from '@/components/TranscriptionView'
import VideoUploader, { type UploaderBusy } from '@/components/VideoUploader'
import { applyAutocut, type AutocutOptions } from '@/lib/autocut'
import { COPY } from '@/lib/copy'
import { activeCue, buildCues } from '@/lib/cues'
import { failsContrast, sampleZoneLuminance } from '@/lib/contrast'
import { historyReducer } from '@/lib/history'
import { buildPhrases } from '@/lib/phrases'
import { STYLE_PRESETS, resolveStyle } from '@/lib/styles/presets'
import { usePlayback } from '@/lib/usePlayback'
import { buildCutSegments } from '@/lib/timeline'
import { canvasFor } from '@/lib/canvas'
import { NO_OFFSET, clampOffset, textRect, type TextOffset } from '@/lib/textLayout'
import type { EditDoc } from '@/types/project'
import type { ImageAsset, Layer, PhraseUnit, StylePresetId, VideoAsset } from '@/types/project'

type Screen = 'upload' | 'editor'

interface ConfirmResult {
  videos: VideoAsset[]
  images: ImageAsset[]
  phrases: PhraseUnit[]
}

export default function Page() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [images, setImages] = useState<ImageAsset[]>([])
  const [busy, setBusy] = useState<UploaderBusy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  // en móvil la línea de tiempo se puede plegar (en escritorio siempre visible)
  const [timelineFolded, setTimelineFolded] = useState(false)
  const closeToast = useCallback(() => setToast(null), [])

  const [history, dispatchHistory] = useReducer(historyReducer, {
    past: [],
    present: { phrases: [], imageLayers: [], styleId: null } as EditDoc,
    future: [],
  })
  const edit = history.present
  const setEdit = useCallback(
    (doc: EditDoc) => dispatchHistory({ type: 'edit', doc }),
    []
  )

  const phrases = edit.phrases
  const segments = useMemo(
    () => buildCutSegments(videos, phrases),
    [videos, phrases]
  )
  const playback = usePlayback(segments)
  const cues = useMemo(
    () => (edit.styleId ? buildCues(edit.styleId, phrases, segments) : []),
    [edit.styleId, phrases, segments]
  )
  const outlineOn = edit.styleId ? !!edit.outlines?.[edit.styleId] : false
  // estilo tal como se dibuja (con el contorno opcional) — el export aplica lo mismo
  const preset = useMemo(
    () => (edit.styleId ? resolveStyle(STYLE_PRESETS[edit.styleId], { outline: outlineOn }) : null),
    [edit.styleId, outlineOn]
  )
  const textOffset = useMemo(
    () => (edit.styleId ? clampOffset(edit.textOffsets?.[edit.styleId]) : NO_OFFSET),
    [edit.styleId, edit.textOffsets]
  )
  // aspecto del proyecto = el del primer video (el export usa la misma regla)
  const canvas = useMemo(() => canvasFor(videos[0]?.width, videos[0]?.height), [videos])

  // ---- restore de project.json al abrir ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/project')
        const data = (await res.json()) as { project: ProjectSnapshot | null }
        if (cancelled || !data.project) return
        const snap = data.project
        const validVideos = snap.videos.filter((v) => v.kind === 'video')
        if (!validVideos.length) return
        setVideos(validVideos)
        setImages(snap.images ?? [])
        dispatchHistory({
          type: 'reset',
          doc: { ...snap.edit, phrases: snap.edit.phrases, imageLayers: snap.edit.imageLayers ?? [], styleId: snap.edit.styleId ?? null },
        })
        setScreen('editor')
      } catch {
        /* sin proyecto guardado: primera pantalla */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---- autosave del proyecto ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (screen !== 'editor' || !videos.length) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 1 as const,
          videos,
          images,
          edit,
        }),
      }).catch(() => {})
    }, 800)
  }, [screen, videos, images, edit])

  // ---- flujo de subida ----
  const confirmFiles = async (files: File[]) => {
    setError(null)
    const videoFiles = files.filter((f) => f.type.startsWith('video/'))
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))

    try {
      // subida
      const saved: (VideoAsset | ImageAsset)[] = []
      for (let i = 0; i < files.length; i++) {
        setBusy({ phase: 'upload', done: i, total: files.length, progress: i / files.length })
        const fd = new FormData()
        fd.append('files', files[i])
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = (await res.json()) as { files?: (VideoAsset | ImageAsset)[]; error?: string }
        if (!res.ok || !data.files?.length) {
          setError(data.error ?? COPY.invalidFile)
          setBusy(null)
          return
        }
        saved.push(...data.files)
      }
      setBusy({ phase: 'upload', done: files.length, total: files.length, progress: 1 })

      const newVideos = saved.filter((f): f is VideoAsset => f.kind === 'video')
      const newImages = saved.filter((f): f is ImageAsset => f.kind === 'image')
      if (!newVideos.length) {
        setError(COPY.invalidFile)
        setBusy(null)
        return
      }

      // transcripción por video, en orden
      let newPhrases: PhraseUnit[] = []
      for (let i = 0; i < newVideos.length; i++) {
        setBusy({ phase: 'transcribe', done: i, total: newVideos.length, progress: (i + 1) / newVideos.length })
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: newVideos[i].id }),
        })
        const data = (await res.json()) as {
          transcription?: Parameters<typeof buildPhrases>[1]
          error?: string
        }
        if (!res.ok || !data.transcription) {
          setError(data.error ?? COPY.transcribeFail)
          setBusy(null)
          return
        }
        const tr = { ...data.transcription, duration: data.transcription.duration || newVideos[i].duration }
        newPhrases = newPhrases.concat(buildPhrases(newVideos[i].id, tr, newVideos[i].duration))
        newVideos[i] = { ...newVideos[i], transcription: tr }
      }

      // capas de imagen con valores por defecto (40% x 21%, abajo-centro, 3 s desde el cabezal)
      const baseLayers: Layer[] = edit.imageLayers
      const at = playback.getTime()
      const newLayers: Layer[] = newImages.map((img, i) =>
        defaultImageLayer(img.id, at, baseLayers.length + i)
      )

      setVideos((prev) => [...prev, ...newVideos])
      setImages((prev) => [...prev, ...newImages])
      setEdit({ ...edit, phrases: [...phrases, ...newPhrases], imageLayers: [...baseLayers, ...newLayers] })
      setBusy(null)
      setScreen('editor')
    } catch {
      setError(COPY.invalidFile)
      setBusy(null)
    }
  }

  // ---- acciones de edición ----
  const toggleUnit = (id: string) => {
    setEdit({ ...edit, phrases: phrases.map((p) => (p.id === id ? { ...p, removed: !p.removed, reason: !p.removed ? 'manual' : undefined } : p)) })
  }

  const adjustUnit = (id: string, start: number, end: number) => {
    setEdit({
      ...edit,
      phrases: phrases.map((p) => (p.id === id ? { ...p, start, end, removed: false, reason: 'manual' } : p)),
    })
  }

  const runAutocut = (opts: AutocutOptions) => {
    const { phrases: next } = applyAutocut(phrases, opts)
    setEdit({ ...edit, phrases: next })
    setToast({ id: Date.now(), text: AUTOCUT_DONE })
  }

  const patchImageLayer = (layerId: string, patch: Partial<Layer>) => {
    setEdit({
      ...edit,
      imageLayers: edit.imageLayers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
    })
  }

  const setImageTime = (layerId: string, start: number, end: number) => {
    patchImageLayer(layerId, { start, end })
  }

  const toggleImageLayer = (layerId: string) => {
    const layer = edit.imageLayers.find((l) => l.id === layerId)
    if (!layer) return
    patchImageLayer(layerId, { enabled: layer.enabled === false })
  }

  const removeImageLayer = (layerId: string) => {
    setEdit({ ...edit, imageLayers: edit.imageLayers.filter((l) => l.id !== layerId) })
  }

  const removeAllImageLayers = () => setEdit({ ...edit, imageLayers: [] })

  // el bloque de texto completo del estilo elegido se mueve como las imágenes
  const editRef = useRef(edit)
  editRef.current = edit
  const moveText = useCallback(
    (offset: TextOffset) => {
      const cur = editRef.current
      if (!cur.styleId) return
      setEdit({ ...cur, textOffsets: { ...cur.textOffsets, [cur.styleId]: clampOffset(offset) } })
    },
    [setEdit]
  )

  // una imagen borrada de la pista se vuelve a poner con un clic en el panel
  const addImageLayer = (imageId: string) => {
    const t = Math.min(playback.getTime(), Math.max(0, playback.duration - IMAGE_DEFAULT_SECONDS))
    setEdit({
      ...edit,
      imageLayers: [...edit.imageLayers, defaultImageLayer(imageId, t, edit.imageLayers.length)],
    })
  }

  // ---- contraste: verificado contra el fotograma real del preview ----
  const [contrastIssue, setContrastIssue] = useState(false)
  useEffect(() => {
    if (!preset) {
      setContrastIssue(false)
      return
    }
    const sampler = document.createElement('canvas')
    let last = 0
    return playback.subscribe((t) => {
      const now = performance.now()
      if (now - last < 400) return
      last = now
      const cue = activeCue(cues, t)
      const el = playback.activeVideoElement()
      if (!cue || !el) return
      const lum = sampleZoneLuminance(el, textRect(preset, cue.side, textOffset, canvas), canvas, sampler)
      if (lum !== null) setContrastIssue(failsContrast(preset, lum))
    })
  }, [preset, cues, playback, canvas, textOffset])

  const canExport = videos.length > 0 && segments.length > 0

  if (screen === 'upload' && !videos.length) {
    return (
      <main className="landing">
        <VideoUploader busy={busy} error={error} onConfirm={confirmFiles} />
      </main>
    )
  }

  return (
    <main className="editor">
      <header className="editor-header">
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!history.past.length}
            onClick={() => dispatchHistory({ type: 'undo' })}
          >
            Deshacer
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!history.future.length}
            onClick={() => dispatchHistory({ type: 'redo' })}
          >
            Rehacer
          </button>
          <VideoAddButton onConfirm={confirmFiles} busy={busy} />
        </div>
      </header>

      <div className="editor-left">
        <section className="panel">
          <div className="panel-head">
            <h2>Autorrecorte</h2>
          </div>
          <AutocutPanel onApply={runAutocut} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Estilo</h2>
          </div>
          <StylePicker
            styleId={edit.styleId}
            onSelect={(id: StylePresetId | null) => setEdit({ ...edit, styleId: id })}
            outline={outlineOn}
            outlines={edit.outlines ?? {}}
            canvas={canvas}
            videos={videos}
            phrases={phrases}
            segments={segments}
            onOutline={(on) =>
              edit.styleId && setEdit({ ...edit, outlines: { ...edit.outlines, [edit.styleId]: on } })
            }
            contrastIssue={contrastIssue}
          />
        </section>

        <ImagesPanel
          images={images}
          imageLayers={edit.imageLayers}
          onToggle={toggleImageLayer}
          onRemove={removeImageLayer}
          onRemoveAll={removeAllImageLayers}
          onAdd={addImageLayer}
        />

        <ExportButton
          disabled={!canExport}
          videos={videos.map((v) => ({ id: v.id }))}
          phrases={phrases}
          imageLayers={edit.imageLayers}
          styleId={edit.styleId}
          outline={outlineOn}
          textOffset={textOffset}
        />
      </div>

      <div
        className="editor-stage"
        style={{ '--canvas-ratio': canvas.h / canvas.w } as React.CSSProperties}
      >
        <PreviewPlayer
          canvas={canvas}
          videos={videos}
          images={images}
          imageLayers={edit.imageLayers}
          stylePreset={preset}
          cues={cues}
          playback={playback}
          onImagePatch={patchImageLayer}
          textOffset={textOffset}
          onTextMove={moveText}
        />
      </div>

      <div className="editor-right">
        <section className="panel">
          <div className="panel-head">
            <h2>Transcripción</h2>
          </div>
          <TranscriptionView
            videos={videos}
            phrases={phrases}
            segments={segments}
            playback={playback}
            onToggle={toggleUnit}
          />
        </section>
      </div>

      <div className={`editor-timeline ${timelineFolded ? 'is-folded' : ''}`}>
        <section className="panel">
          <div className="panel-head">
            <h2>Línea de tiempo</h2>
            <button
              type="button"
              className="btn btn-mini only-compact"
              aria-expanded={!timelineFolded}
              aria-controls="timeline-body"
              onClick={() => setTimelineFolded((f) => !f)}
            >
              {timelineFolded ? 'Desplegar' : 'Plegar'}
            </button>
          </div>
          <div id="timeline-body" className="timeline-body">
          <Timeline
            videos={videos}
            phrases={phrases}
            segments={segments}
            imageLayers={edit.imageLayers}
            images={images}
            hasStyle={!!edit.styleId}
            playback={playback}
            onToggleUnit={toggleUnit}
            onAdjustUnit={adjustUnit}
            onImageTime={setImageTime}
          />
          </div>
        </section>
      </div>

      {toast && <Toast key={toast.id} text={toast.text} onClose={closeToast} />}

      {error && screen === 'editor' && (
        <div className="toast-error" role="alert">
          {error}
          <button type="button" className="icon-btn" onClick={() => setError(null)} aria-label="Cerrar">
            ×
          </button>
        </div>
      )}
    </main>
  )
}

const IMAGE_DEFAULT_SECONDS = 3
const AUTOCUT_DONE = 'Autorrecorte listo'
const TOAST_MS = 5_000

/** Aviso breve: se cierra solo a los 5 s o al tocarlo. */
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, TOAST_MS)
    return () => clearTimeout(id)
  }, [text, onClose])
  return (
    <button type="button" className="toast" role="status" onClick={onClose}>
      {text}
    </button>
  )
}

/** Imagen de apoyo por defecto: 40% de ancho x 21% de alto, abajo-centro (debajo de la cara), 3 s. */
function defaultImageLayer(imageId: string, start: number, index: number): Layer {
  const s = Math.max(0, start)
  return {
    id: `img-${imageId}-${Date.now().toString(36)}-${index}`,
    type: 'image',
    src: imageId,
    start: s,
    end: s + IMAGE_DEFAULT_SECONDS,
    order: 10 + index,
    x: 50,
    y: 78,
    width: 40,
    height: 21,
    enabled: true,
  }
}

interface ProjectSnapshot {
  videos: VideoAsset[]
  images: ImageAsset[]
  edit: EditDoc
}

/** Botón + del header: añade más videos/imágenes al proyecto abierto. */
function VideoAddButton({
  onConfirm,
  busy,
}: {
  onConfirm: (files: File[]) => void
  busy: UploaderBusy | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={!!busy}
        aria-busy={!!busy}
        aria-label="Añadir videos o imágenes"
        onClick={() => setOpen(true)}
      >
        {busy ? <span className="spinner" aria-hidden /> : '+'}
      </button>
      {open && (
        <div className="modal-scrim" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <VideoUploader compact busy={busy} error={null} onConfirm={(files) => {
              setOpen(false)
              onConfirm(files)
            }} />
          </div>
        </div>
      )}
    </>
  )
}
