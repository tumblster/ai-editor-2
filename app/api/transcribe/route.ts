import { readFile, unlink, writeFile, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { COPY } from '@/lib/copy'
import { extractAudio } from '@/lib/ffmpeg'
import { transcribeWithGroq } from '@/lib/groq'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { TMP_DIR, VIDEO_RE, fileExists, uploadsPath } from '@/lib/uploads'
import type { TranscriptionResult } from '@/types/project'

export const runtime = 'nodejs'

/** Si Groq no devuelve tiempos por palabra, se aproximan desde los segmentos. */
function normalize(res: {
  text?: string
  duration?: number
  language?: string
  words?: { word: string; start: number; end: number }[]
  segments?: { id: number; text: string; start: number; end: number }[]
}): TranscriptionResult {
  let words = res.words ?? []
  if (!words.length && res.segments?.length) {
    words = res.segments.flatMap((seg) => {
      const tokens = seg.text.trim().split(/\s+/).filter(Boolean)
      if (!tokens.length || seg.end <= seg.start) return []
      const dur = (seg.end - seg.start) / tokens.length
      return tokens.map((word, i) => ({
        word,
        start: seg.start + i * dur,
        end: seg.start + (i + 1) * dur,
      }))
    })
  }
  return {
    text: res.text ?? '',
    duration: res.duration ?? 0,
    language: res.language ?? 'es',
    words,
    segments: res.segments ?? [],
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`transcribe:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: COPY.rateLimited }, { status: 429 })
  }

  let fileId = ''
  try {
    const body = (await req.json()) as { fileId?: string }
    fileId = body.fileId ?? ''
    if (!VIDEO_RE.test(fileId)) {
      return NextResponse.json({ error: COPY.transcribeFail }, { status: 400 })
    }
    const videoPath = uploadsPath(fileId)
    if (!(await fileExists(videoPath))) {
      return NextResponse.json({ error: COPY.transcribeFail }, { status: 404 })
    }

    // Audio mono 16 kHz para Groq — el video completo no entra por tamaño
    await mkdir(TMP_DIR, { recursive: true })
    const audioPath = `${TMP_DIR}/${randomUUID()}.m4a`
    await extractAudio(videoPath, audioPath)
    const audioBuffer = await readFile(audioPath)

    const raw = await transcribeWithGroq(audioBuffer, `${fileId}.m4a`)
    const transcription = normalize(raw)

    // transcription.json junto al video — el video NO se borra
    await writeFile(`${videoPath}.transcription.json`, JSON.stringify(transcription), 'utf-8')
    await unlink(audioPath).catch(() => {})

    return NextResponse.json({ transcription })
  } catch (err) {
    console.error('[transcribe] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: COPY.transcribeFail }, { status: 500 })
  }
}
