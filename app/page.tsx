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
import { applyAutocut, formatSummary, type AutocutOptions } from '@/lib/autocut'
import { COPY } from '@/lib/copy'
import { activeCue, buildCues } from '@/lib/cues'
import { failsContrast, sampleZoneLuminance, zoneFor } from '@/lib/contrast'
import { historyReducer } from '@/lib/history'
import { buildPhrases } from '@/lib/phrases'
import { STYLE_PRESETS } from '@/lib/styles/presets'
import { usePlayback } from '@/lib/usePlayback'
import { buildCutSegments } from '@/lib/timeline'
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
  const [summary, setSummary] = useState<string | null>(null)

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
  const preset = edit.styleId ? STYLE_PRESETS[edit.styleId] : null

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
          doc: { phrases: snap.edit.phrases, imageLayers: snap.edit.imageLayers, styleId: snap.edit.styleId },
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
          edit: { phrases, imageLayers: edit.imageLayers, styleId: edit.styleId },
        }),
      }).catch(() => {})
    }, 800)
  }, [screen, videos, images, phrases, edit.imageLayers, edit.styleId])

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
      setEdit({ phrases: [...phrases, ...newPhrases], imageLayers: [...baseLayers, ...newLayers], styleId: edit.styleId })
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
    const { phrases: next, summary: s } = applyAutocut(phrases, opts)
    setEdit({ ...edit, phrases: next })
    setSummary(formatSummary(s))
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
    const canvas = document.createElement('canvas')
    let last = 0
    return playback.subscribe((t) => {
      const now = performance.now()
      if (now - last < 400) return
      last = now
      const cue = activeCue(cues, t)
      const el = playback.activeVideoElement()
      if (!cue || !el) return
      const lum = sampleZoneLuminance(el, zoneFor(preset, cue.side), canvas)
      if (lum !== null) setContrastIssue(failsContrast(preset, lum))
    })
  }, [preset, cues, playback])

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
          <AutocutPanel onApply={runAutocut} summary={summary} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Estilo</h2>
          </div>
          <StylePicker
            styleId={edit.styleId}
            onSelect={(id: StylePresetId | null) => setEdit({ ...edit, styleId: id })}
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
        />
      </div>

      <div className="editor-stage">
        <PreviewPlayer
          videos={videos}
          images={images}
          imageLayers={edit.imageLayers}
          stylePreset={preset}
          cues={cues}
          playback={playback}
          onImagePatch={patchImageLayer}
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

      <div className="editor-timeline">
        <section className="panel">
          <div className="panel-head">
            <h2>Línea de tiempo</h2>
          </div>
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
        </section>
      </div>

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
        className="btn btn-primary"
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
