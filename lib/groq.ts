// Cliente Groq — SOLO se importa en rutas de servidor (app/api/).
// Nunca lo importes desde componentes de React.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

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

export interface GroqVerboseResponse {
  text: string
  segments: GroqSegment[]
  words?: GroqWord[]
  duration: number
  language: string
}

export async function transcribeWithGroq(
  fileBuffer: Buffer,
  fileName: string
): Promise<GroqVerboseResponse> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY no configurada en variables de entorno del servidor')
  }

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'audio/mp4' })
  formData.append('file', blob, fileName)
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'word')
  formData.append('timestamp_granularities[]', 'segment')
  formData.append('language', 'es')

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!res.ok) {
    const errorBody = await res.text()
    console.error('[groq] Error de API:', res.status, errorBody.slice(0, 400))
    throw new Error(`Groq API error: ${res.status}`)
  }

  return (await res.json()) as GroqVerboseResponse
}
