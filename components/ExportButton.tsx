'use client'

// Botón Exportar: POST con el estado completo, descarga del MP4 resultante.

import { useState } from 'react'

import { COPY } from '@/lib/copy'
import type { Layer, PhraseUnit, StylePresetId } from '@/types/project'

interface Props {
  videos: { id: string }[]
  phrases: PhraseUnit[]
  imageLayers: Layer[]
  styleId: StylePresetId | null
}

export default function ExportButton({ videos, phrases, imageLayers, styleId }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportVideo = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos, phrases, imageLayers, styleId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? COPY.exportFail)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'video-editado.mp4'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError(COPY.exportFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export">
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={exportVideo}>
        {busy ? (
          <>
            <span className="spinner" /> Exportando…
          </>
        ) : (
          'Exportar'
        )}
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
