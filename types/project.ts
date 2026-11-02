// Modelo de datos del proyecto — Fase 1.
// `image` y `audio` existen desde ahora para no reescribir la línea de tiempo en Fase 1.5.

export type LayerType = 'video' | 'image' | 'audio' | 'text'

export type StylePresetId = 'chispa' | 'revista' | 'titular' | 'claro' | 'foco'

export interface Layer {
  id: string
  type: LayerType
  src?: string // id del archivo en uploads/
  start: number // tiempo de inicio en segundos (línea de tiempo = tiempo de export)
  end: number // tiempo de fin en segundos
  order: number // z-index / orden en la pila de capas
  // Para imagen (porcentajes sobre el fotograma 1080x1920; x/y son el centro):
  x?: number
  y?: number
  width?: number
  height?: number
  enabled?: boolean // toggle de imagen propia
  // Para audio:
  volume?: number
  muted?: boolean
  // Para texto (estilos predefinidos):
  style?: StylePresetId
  text?: string
}

// ---- Transcripción (Groq verbose_json) ----

export interface GroqWord {
  word: string
  start: number
  end: number
}

export interface GroqSegment {
  id: number
  text: string
  start: number
  end: number
}

export interface TranscriptionResult {
  text: string
  duration: number
  language: string
  words: GroqWord[]
  segments: GroqSegment[]
}

// ---- Frases y cortes ----

export type CutReason = 'silence' | 'filler' | 'retake' | 'manual'

/**
 * Unidad mínima de la línea de tiempo.
 * `phrase` = frase hablada de 3–5 palabras (o muletilla suelta).
 * `gap` = silencio entre frases (o al inicio/fin del video).
 * Juntas particionan el video completo: start/end contiguos, sin huecos ni solapes.
 */
export interface PhraseUnit {
  id: string
  videoId: string
  kind: 'phrase' | 'gap'
  text: string
  start: number // segundos, absolutos en el video fuente
  end: number
  words: GroqWord[]
  removed: boolean
  reason?: CutReason
  isFiller?: boolean
}

export interface VideoAsset {
  id: string
  name: string
  kind: 'video'
  url: string
  duration: number // duración de la pista de video (ffprobe)
  fps?: number // fotogramas por segundo del original; los cortes se alinean a esta rejilla
  width: number
  height: number
  hasAudio: boolean
  transcription?: TranscriptionResult
}

export interface ImageAsset {
  id: string
  name: string
  kind: 'image'
  url: string
}

export type FileAsset = VideoAsset | ImageAsset

// Documento editable — todo lo que Deshacer/Rehacer puede revertir.
export interface EditDoc {
  phrases: PhraseUnit[]
  imageLayers: Layer[]
  styleId: StylePresetId | null
  // contorno opcional por estilo (apagado por defecto)
  outlines?: Partial<Record<StylePresetId, boolean>>
}

export interface ProjectState {
  version: 1
  videos: VideoAsset[]
  images: ImageAsset[]
  edit: EditDoc
}

// Segmento activo en la línea de tiempo (una unidad mantenida, con su mapa fuente↔timeline).
export interface CutSegment {
  unitId: string
  videoId: string
  videoIndex: number
  srcStart: number
  srcEnd: number
  tlStart: number
  tlEnd: number
}
