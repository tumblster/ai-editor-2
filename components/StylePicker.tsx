'use client'

// Selector de estilo: vista previa a la izquierda, tarjetas a la derecha con el
// mismo clip de ejemplo, y botones Back y Next.

import { CaptionRender, StyleThumb, EXAMPLE_WORDS } from './CaptionRender'
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
    // ciclo: -1 (ninguno) → 0 → … → 4 → -1
    const raw = currentIdx + dir
    if (raw >= ids.length) onSelect(null)
    else if (raw < -1) onSelect(ids[ids.length - 1])
    else onSelect(raw === -1 ? null : ids[raw])
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
              if (el) el.style.transform = `scale(${(el.parentElement?.clientWidth || 120) / DESIGN_W})`
            }}
          >
            {preset && <StylePreviewInner presetId={preset.id} />}
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
  return <CaptionRender preset={STYLE_PRESETS[presetId]} cue={exampleCue(presetId)} />
}
