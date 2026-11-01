'use client'

// Selector de estilo: vista previa a la izquierda, tarjetas a la derecha con el
// mismo clip de ejemplo, botones Back y Next, y sorpresa (dado).

import { StyleThumb, EXAMPLE_WORDS } from './CaptionRender'
import { DESIGN_H, DESIGN_W, STYLE_PRESETS, STYLE_IDS } from '@/lib/styles/presets'
import { markEmph } from '@/lib/cues'
import type { Cue } from '@/lib/cues'
import type { StylePresetId } from '@/types/project'

interface Props {
  styleId: StylePresetId | null
  onSelect: (id: StylePresetId | null) => void
  contrastIssue: boolean
}

function exampleCue(id: StylePresetId): Cue {
  const preset = STYLE_PRESETS[id]
  const emph = preset.emphasis
    ? markEmph(preset.emphasis.scope, EXAMPLE_WORDS)
    : EXAMPLE_WORDS.map(() => false)
  return {
    id: `example-${id}`,
    start: 0,
    end: 1,
    words: EXAMPLE_WORDS.map((text, i) => ({ text, emph: emph[i] })),
    side: 'left',
  }
}

export default function StylePicker({ styleId, onSelect, contrastIssue }: Props) {
  const ids = STYLE_IDS
  const currentIdx = styleId ? ids.indexOf(styleId) : -1

  const step = (dir: 1 | -1) => {
    const next = (currentIdx + 1 + dir) % (ids.length + 1) - 1
    // ciclo: -1 (ninguno) → 0 → … → 4 → -1
    const raw = currentIdx + dir
    if (raw >= ids.length) onSelect(null)
    else if (raw < -1) onSelect(ids[ids.length - 1])
    else onSelect(raw === -1 ? null : ids[raw])
    void next
  }

  const surprise = () => {
    let pick = ids[Math.floor(Math.random() * ids.length)]
    if (pick === styleId) pick = ids[(ids.indexOf(pick) + 1) % ids.length]
    onSelect(pick)
  }

  const preset = styleId ? STYLE_PRESETS[styleId] : null

  return (
    <div className="panel-body style-picker">
      <div className="style-preview">
        <div className="style-stage">
          <div
            style={{
              width: DESIGN_W,
              height: DESIGN_H,
              transformOrigin: '0 0',
              position: 'relative',
            }}
            ref={(el) => {
              if (el) el.style.transform = `scale(${el.parentElement ? el.parentElement.clientWidth / DESIGN_W : 0.15})`
            }}
          >
            {preset ? (
              <StylePreviewInner presetId={preset.id} />
            ) : (
              <div className="style-none">Sin estilo — export limpio</div>
            )}
          </div>
        </div>
      </div>

      <div className="style-cards">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            className={`style-card ${styleId === id ? 'is-selected' : ''}`}
            onClick={() => onSelect(styleId === id ? null : id)}
          >
            <StyleThumb preset={STYLE_PRESETS[id]} width={64} />
            <span className="style-card-name">{STYLE_PRESETS[id].name}</span>
          </button>
        ))}
      </div>

      <div className="style-nav">
        <button type="button" className="btn btn-ghost" onClick={() => step(-1)}>
          Back
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => step(1)}>
          Next
        </button>
        <button type="button" className="icon-btn" title="Sorpresa" onClick={surprise}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="9" cy="9" r="1.3" fill="currentColor" />
            <circle cx="15" cy="9" r="1.3" fill="currentColor" />
            <circle cx="9" cy="15" r="1.3" fill="currentColor" />
            <circle cx="15" cy="15" r="1.3" fill="currentColor" />
            <circle cx="12" cy="12" r="1.3" fill="currentColor" />
          </svg>
        </button>
        {contrastIssue && (
          <span className="contrast-warn" title="Revisa el contraste del texto contra el video">
            ⚠
          </span>
        )}
      </div>
    </div>
  )
}

function StylePreviewInner({ presetId }: { presetId: StylePresetId }) {
  const { CaptionRender } = require('./CaptionRender') as typeof import('./CaptionRender')
  return <CaptionRender preset={STYLE_PRESETS[presetId]} cue={exampleCue(presetId)} />
}
