import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'

import { ANY_FILE_RE, fileExists, mimeByExt, uploadsPath } from '@/lib/uploads'

export const runtime = 'nodejs'

function toWebStream(p: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const stream = createReadStream(p, start !== undefined ? { start, end } : undefined)
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ANY_FILE_RE.test(id)) return new Response('Not found', { status: 404 })

  const p = uploadsPath(id)
  if (!(await fileExists(p))) return new Response('Not found', { status: 404 })

  const { size } = await stat(p)
  const mime = mimeByExt(id)
  const range = req.headers.get('range')

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
      if (start <= end && start < size) {
        return new Response(toWebStream(p, start, end), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
          },
        })
      }
    }
  }

  return new Response(toWebStream(p), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

export async function HEAD(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ANY_FILE_RE.test(id)) return new Response(null, { status: 404 })
  if (!(await fileExists(uploadsPath(id)))) return new Response(null, { status: 404 })
  return new Response(null, { status: 200 })
}
