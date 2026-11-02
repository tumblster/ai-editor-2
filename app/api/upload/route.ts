import { mkdir, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { COPY } from '@/lib/copy'
import { probeVideo } from '@/lib/ffmpeg'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { MAX_VIDEO_BYTES, UPLOADS_DIR, uploadsPath } from '@/lib/uploads'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`upload:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: COPY.rateLimited }, { status: 429 })
  }

  try {
    const formData = await req.formData()
    const files = formData.getAll('files').filter((f): f is File => f instanceof File)
    if (!files.length) {
      return NextResponse.json({ error: COPY.invalidFile }, { status: 400 })
    }

    await mkdir(UPLOADS_DIR, { recursive: true })
    const saved: unknown[] = []

    for (const file of files) {
      const isVideo = file.type.startsWith('video/')
      const isImage = file.type.startsWith('image/')
      if (!isVideo && !isImage) {
        return NextResponse.json({ error: COPY.invalidFile }, { status: 400 })
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        return NextResponse.json({ error: COPY.invalidFile }, { status: 400 })
      }

      const ext = (file.name.split('.').pop() ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 5)
      const id = `${randomUUID()}.${isVideo ? ext || 'mp4' : ext || 'png'}`
      const buffer = Buffer.from(await file.arrayBuffer())
      await writeFile(uploadsPath(id), buffer)

      if (isVideo) {
        const probe = await probeVideo(uploadsPath(id))
        saved.push({
          id,
          kind: 'video',
          name: file.name,
          url: `/api/files/${id}`,
          duration: probe.duration,
          fps: probe.fps,
          width: probe.width,
          height: probe.height,
          hasAudio: probe.hasAudio,
        })
      } else {
        saved.push({
          id,
          kind: 'image',
          name: file.name,
          url: `/api/files/${id}`,
        })
      }
    }

    return NextResponse.json({ files: saved })
  } catch (err) {
    console.error('[upload] error:', err)
    return NextResponse.json({ error: COPY.invalidFile }, { status: 500 })
  }
}
