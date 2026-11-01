'use client'

// Imágenes de apoyo: toggle, borrar individual, borrar todas.
// Mover y redimensionar se hace directo sobre el preview.

import type { ImageAsset, Layer } from '@/types/project'

interface Props {
  images: ImageAsset[]
  imageLayers: Layer[]
  onToggle: (layerId: string) => void
  onRemove: (layerId: string) => void
  onRemoveAll: () => void
}

export default function ImagesPanel({ images, imageLayers, onToggle, onRemove, onRemoveAll }: Props) {
  if (!images.length) return null
  const urlBySrc = new Map(images.map((img) => [img.id, img.url]))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Imágenes</h2>
        {imageLayers.length > 0 && (
          <button type="button" className="btn btn-mini" onClick={onRemoveAll}>
            Borrar todas
          </button>
        )}
      </div>
      <div className="images-grid">
        {images.map((img) => {
          const layer = imageLayers.find((l) => l.src === img.id)
          return (
            <div key={img.id} className="image-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name} />
              {layer && (
                <div className="image-item-actions">
                  <label className="switch" title="Mostrar u ocultar">
                    <input
                      type="checkbox"
                      checked={layer.enabled !== false}
                      onChange={() => onToggle(layer.id)}
                    />
                    <i />
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Borrar"
                    onClick={() => onRemove(layer.id)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
