'use client'

// Render de un cue con un preset — mismo espacio 1080x1920 y mismos parámetros
// que el ASS del export. El contenedor padre aplica la escala.

import type { CSSProperties } from 'react'

import type { Cue } from '@/lib/cues'
import { markEmph } from '@/lib/cues'
import { DESIGN_H, DESIGN_W, STYLE_PRESETS, assFontScale, type StylePreset, type TextStyle } from '@/lib/styles/presets'
import type { StylePresetId } from '@/types/project'

function rgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function textStyleCss(t: TextStyle): CSSProperties {
  return {
    fontFamily: `'${t.font}', 'Segoe UI', sans-serif`,
    fontWeight: t.bold ? 700 : 400, // ASS solo tiene negrita 700
    fontStyle: t.italic ? 'italic' : 'normal',
    fontSize: t.size,
    color: t.color,
    lineHeight: assFontScale(t.font), // alto de línea de libass = ascendente + descendente
    // ASS desplaza la sombra en x e y por igual
    textShadow:
      t.shadowOffset > 0
        ? `${t.shadowOffset}px ${t.shadowOffset}px 0 rgba(0,0,0,${t.shadowAlpha})`
        : undefined,
    // El trazo CSS va centrado en el borde del glifo y paint-order deja visible solo
    // la mitad exterior: el doble de ancho da el mismo contorno exterior que \bord de ASS.
    WebkitTextStroke:
      t.outlineWidth > 0 ? `${t.outlineWidth * 2}px ${rgba(t.outlineColor, t.outlineAlpha)}` : undefined,
    paintOrder: 'stroke fill',
  }
}

export function CaptionRender({ preset, cue }: { preset: StylePreset; cue: Cue | null }) {
  const { base, placement, emphasis } = preset

  const words = (cue?.words ?? []).map((w, i) => {
    if (!w.emph || !emphasis) {
      return <span key={i}>{w.text} </span>
    }
    const css: CSSProperties = { color: emphasis.color }
    if (emphasis.scale !== 1) css.fontSize = base.size * emphasis.scale
    if (emphasis.italic) css.fontStyle = 'italic'
    if (emphasis.font) css.fontFamily = `'${emphasis.font}', Georgia, serif`
    if (emphasis.uppercase) css.textTransform = 'uppercase'
    // las palabras de énfasis llevan sombra; donde hay sombra no va contorno
    if (emphasis.shadowOffset > 0) {
      css.textShadow = `${emphasis.shadowOffset}px ${emphasis.shadowOffset}px 0 rgba(0,0,0,${emphasis.shadowAlpha})`
      if (base.outlineWidth > 0) css.WebkitTextStroke = '0px transparent'
    }
    return (
      <span key={i} style={css}>
        {w.text}{' '}
      </span>
    )
  })

  if (placement.kind === 'blocks') {
    const [bx0, bx1] = placement.band
    const blockStyle = (side: 'left' | 'right'): CSSProperties => {
      const [x0, x1] = side === 'left' ? placement.left : placement.right
      return {
        position: 'absolute',
        left: `${x0}%`,
        width: `${x1 - x0}%`,
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign: side === 'left' ? 'left' : 'right',
        ...textStyleCss(base),
      }
    }
    return (
      <>
        <div
          style={{
            position: 'absolute',
            left: `${bx0}%`,
            width: `${bx1 - bx0}%`,
            top: 0,
            bottom: 0,
            background: `rgba(255,255,255,${placement.bandAlpha})`,
          }}
        />
        {cue && <div style={blockStyle(cue.side)}>{words}</div>}
      </>
    )
  }

  if (!cue) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: '8%',
        width: '84%',
        top: `${placement.yPercent}%`,
        transform: 'translateY(-50%)',
        textAlign: 'center',
        ...textStyleCss(base),
      }}
    >
      {words}
    </div>
  )
}

/** Tarjeta en miniatura con el mismo clip de ejemplo para los cinco estilos. */
export function StyleThumb({ preset, width }: { preset: StylePreset; width: number }) {
  const scale = width / DESIGN_W
  return (
    <div className="style-thumb" style={{ width, height: DESIGN_H * scale }}>
      <div
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          position: 'relative',
        }}
      >
        <ExampleCue presetId={preset.id} />
      </div>
    </div>
  )
}

// El mismo clip de ejemplo para todas las tarjetas
export const EXAMPLE_WORDS = ['solo', '3', 'pasos', 'y', 'listo']

function ExampleCue({ presetId }: { presetId: StylePresetId }) {
  const preset = STYLE_PRESETS[presetId]
  const emph = preset.emphasis
    ? markEmph(preset.emphasis.scope, EXAMPLE_WORDS)
    : EXAMPLE_WORDS.map(() => false)
  const cue: Cue = {
    id: 'example',
    start: 0,
    end: 1,
    words: EXAMPLE_WORDS.map((text, i) => ({ text, emph: emph[i] })),
    side: 'left',
  }
  return <CaptionRender preset={preset} cue={cue} />
}
