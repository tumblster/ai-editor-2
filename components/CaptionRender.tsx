'use client'

// Render de un cue con un preset — mismo espacio 1080x1920 y mismos parámetros
// que el ASS del export. El contenedor padre aplica la escala.

import type { CSSProperties } from 'react'

import { cueLines, type Cue, type CueWord } from '@/lib/cues'
import {
  assFontScale,
  outlineLayers,
  shadowBlurCss,
  shadowXY,
  type StylePreset,
  type TextStyle,
} from '@/lib/styles/presets'

/** Sombra difusa en CSS: -45° (abajo a la derecha), desenfoque según el tamaño de la letra. */
function diffuseShadowCss(size: number, distance: number, alpha: number): string {
  const { x, y } = shadowXY(distance)
  return `${x}px ${y}px ${shadowBlurCss(size)}px rgba(0,0,0,${alpha})`
}
import { COLLISION_SHADOW, NO_OFFSET, type TextOffset } from '@/lib/textLayout'

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
    // sombra difusa (DIFFUSE_SHADOW): mismo desplazamiento, opacidad y desenfoque que el ASS
    textShadow: t.shadowOffset > 0 ? diffuseShadowCss(t.size, t.shadowOffset, t.shadowAlpha) : undefined,
    // El trazo CSS va centrado en el borde del glifo y paint-order deja visible solo
    // la mitad exterior: el doble de ancho da el mismo contorno exterior que \bord de ASS.
    WebkitTextStroke:
      t.outlineWidth > 0 ? `${t.outlineWidth * 2}px ${rgba(t.outlineColor, t.outlineAlpha)}` : undefined,
    paintOrder: 'stroke fill',
  }
}

interface CaptionProps {
  preset: StylePreset
  cue: Cue | null
  offset?: TextOffset // bloque movido (% del lienzo)
  collision?: boolean // una imagen queda debajo: el texto lleva sombra
  onDragStart?: (e: React.PointerEvent) => void // solo en el reproductor
}

export function CaptionRender({ preset, cue, offset = NO_OFFSET, collision = false, onDragStart }: CaptionProps) {
  const { placement } = preset
  // Contorno encendido: dos capas como en el ASS. Abajo el contorno fino, arriba
  // el texto con sus sombras: el contorno queda detrás y la sombra prevalece.
  const layers = outlineLayers(preset)
  const over = layers ? layers.over : preset
  const under = layers?.under ?? null
  // la imagen va detrás y el texto encima con sombra
  const overBase =
    collision && over.base.shadowOffset <= 0
      ? {
          ...over.base,
          outlineWidth: 0,
          shadowOffset: COLLISION_SHADOW.offset,
          shadowAlpha: COLLISION_SHADOW.alpha,
        }
      : over.base
  const drag: CSSProperties = onDragStart
    ? { pointerEvents: 'auto', cursor: 'move', touchAction: 'none', userSelect: 'none' }
    : {}

  const wordsFor = (p: StylePreset, base: TextStyle) => {
    const emphasis = p.emphasis
    const word = (w: CueWord, i: number) => {
      if (!w.emph || !emphasis) {
        return <span key={i}>{w.text} </span>
      }
      const css: CSSProperties = { color: emphasis.color }
      if (emphasis.scale !== 1) css.fontSize = base.size * emphasis.scale
      if (emphasis.italic) css.fontStyle = 'italic'
      if (emphasis.font) css.fontFamily = `'${emphasis.font}', Georgia, serif`
      if (emphasis.uppercase) css.textTransform = 'uppercase'
      // las palabras de énfasis llevan sombra (en la capa de arriba)
      if (emphasis.shadowOffset > 0) {
        css.textShadow = diffuseShadowCss(base.size * emphasis.scale, emphasis.shadowOffset, emphasis.shadowAlpha)
        if (base.outlineWidth > 0) css.WebkitTextStroke = '0px transparent'
      }
      return (
        <span key={i} style={css}>
          {w.text}{' '}
        </span>
      )
    }
    // regla 2: la palabra resaltada va sola en su línea; cada línea, un solo estilo
    const words = (cue?.words ?? []).map((w) => (emphasis ? w : { ...w, emph: false }))
    let n = 0
    return cueLines(words).map((line, li) => (
      <div key={li}>{line.map((w) => word(w, n++))}</div>
    ))
  }

  // capa de arriba (interactiva) y, si hay contorno, la de abajo (decorativa)
  const textLayers = (box: CSSProperties) => (
    <>
      {under && (
        <div aria-hidden style={{ ...box, ...textStyleCss(under.base), pointerEvents: 'none' }}>
          {wordsFor(under, under.base)}
        </div>
      )}
      <div className="caption-text" style={{ ...box, ...textStyleCss(overBase), ...drag }} onPointerDown={onDragStart}>
        {wordsFor(over, overBase)}
      </div>
    </>
  )

  if (placement.kind === 'blocks') {
    const [bx0, bx1] = placement.band
    const blockBox = (side: 'left' | 'right'): CSSProperties => {
      const [x0, x1] = side === 'left' ? placement.left : placement.right
      return {
        position: 'absolute',
        left: `${x0 + offset.x}%`,
        width: `${x1 - x0}%`,
        top: `${50 + offset.y}%`,
        transform: 'translateY(-50%)',
        textAlign: side === 'left' ? 'left' : 'right',
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
        {cue && textLayers(blockBox(cue.side))}
      </>
    )
  }

  if (!cue) return null

  return textLayers({
    position: 'absolute',
    left: `${8 + offset.x}%`,
    width: '84%',
    top: `${placement.yPercent + offset.y}%`,
    transform: 'translateY(-50%)',
    textAlign: 'center',
  })
}

// Texto de ejemplo para las tarjetas de estilo si todavía no hay frases
export const EXAMPLE_WORDS = ['solo', '3', 'pasos', 'y', 'listo']
