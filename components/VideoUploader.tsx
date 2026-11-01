'use client'

// Primera pantalla: título grande, subtítulo corto, arrastrar y soltar,
// botón para buscar archivos, subida múltiple en orden y botón Editar mi video.

import { useRef, useState } from 'react'

import { COPY } from '@/lib/copy'

export interface UploaderBusy {
  phase: 'upload' | 'transcribe'
  done: number
  total: number
  progress: number // 0-1
}

interface Props {
  compact?: boolean
  busy: UploaderBusy | null
  error: string | null
  onConfirm: (files: File[]) => void
}

const MAX_VIDEO_BYTES = 500 * 1024 * 1024

export default function VideoUploader({ compact, busy, error, onConfirm }: Props) {
  const [staged, setStaged] = useState<File[]>([])
  const [invalid, setInvalid] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (list: FileList | File[]) => {
    const ok: File[] = []
    let bad = false
    for (const f of Array.from(list)) {
      const isVideo = f.type.startsWith('video/')
      const isImage = f.type.startsWith('image/')
      if ((!isVideo && !isImage) || (isVideo && f.size > MAX_VIDEO_BYTES)) {
        bad = true
        continue
      }
      ok.push(f)
    }
    if (bad) setInvalid(COPY.invalidFile)
    else setInvalid(null)
    if (ok.length) setStaged((prev) => [...prev, ...ok])
  }

  const removeStaged = (i: number) => setStaged((prev) => prev.filter((_, idx) => idx !== i))

  const working = busy !== null

  return (
    <div className={`uploader ${compact ? 'uploader-compact' : ''}`}>
      {!compact && (
        <div className="uploader-head">
          <h1>Tu editor de video</h1>
          <p>Sube uno o más videos, e imágenes de apoyo si quieres.</p>
        </div>
      )}

      <div
        className={`dropzone ${dragOver ? 'dropzone-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!working) addFiles(e.dataTransfer.files)
        }}
      >
        <svg className="dropzone-icon" viewBox="0 0 24 24" width="34" height="34" aria-hidden>
          <path
            d="M12 16V5m0 0l-4 4m4-4l4 4M4 19h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="dropzone-hint">Arrastra tus videos aquí</span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={working}
          onClick={() => inputRef.current?.click()}
        >
          Subir video
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {invalid && <p className="form-error">{invalid}</p>}

      {staged.length > 0 && (
        <ul className="staged-list">
          {staged.map((f, i) => (
            <li key={`${f.name}-${i}`} className={f.type.startsWith('video/') ? 'is-video' : 'is-image'}>
              <span className="staged-name" title={f.name}>
                {f.name}
              </span>
              <span className="staged-size">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Quitar"
                disabled={working}
                onClick={() => removeStaged(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {working && busy && (
        <div className="busy">
          {busy.phase === 'upload' ? (
            <>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
              </div>
              <span className="busy-label">
                {busy.done}/{busy.total}
              </span>
            </>
          ) : (
            <span className="busy-label">
              <span className="spinner" /> {busy.done}/{busy.total}
            </span>
          )}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <button
        type="button"
        className="btn btn-primary btn-big"
        disabled={staged.length === 0 || working}
        onClick={() => {
          onConfirm(staged)
          setStaged([])
        }}
      >
        Editar mi video
      </button>
    </div>
  )
}
