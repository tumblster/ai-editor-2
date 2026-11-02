import { createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { NextResponse } from 'next/server'

import { buildAss } from '@/lib/assBuilder'
import { buildCues } from '@/lib/cues'
import { COPY } from '@/lib/copy'
import { exportTimeoutMs, probeImage, probeVideo, runFfmpeg } from '@/lib/ffmpeg'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import {
  IMAGE_RE,
  VIDEO_RE,
  exportDirPath,
  fileExists,
  removeExportDir,
  sweepStaleExports,
  uploadsPath,
} from '@/lib/uploads'
import { buildCutSegments, totalDuration } from '@/lib/timeline'
import { STYLE_PRESETS } from '@/lib/styles/presets'
import { canvasFor } from '@/lib/canvas'
import { clampOffset } from '@/lib/textLayout'
import type { Layer, PhraseUnit, StylePresetId } from '@/types/project'

export const runtime = 'nodejs'

const f = (n: number) => Math.max(0, n).toFixed(3)

const f6 = (n: number) => Math.max(0, n).toFixed(6)
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

interface ExportBody {
  videos?: { id: string }[]
  phrases?: PhraseUnit[]
  imageLayers?: Layer[]
  styleId?: StylePresetId | null
  outline?: boolean
  textOffset?: { x?: number; y?: number }
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`export:${ip}`, 4, 60_000)) {
    return NextResponse.json({ error: COPY.rateLimited }, { status: 429 })
  }

  const exportId = randomUUID().replace(/-/g, '').slice(0, 8)
  let exportDir = ''
  let handedOff = false // la descarga se encarga de borrar la carpeta

  // mantenimiento: carpetas viejas que quedaron por un corte del servidor
  await sweepStaleExports()

  try {
    const body = (await req.json()) as ExportBody
    const videos = (body.videos ?? []).filter((v) => VIDEO_RE.test(v.id))
    const phrases = (body.phrases ?? []).filter(
      (p) => typeof p.videoId === 'string' && typeof p.start === 'number' && typeof p.end === 'number' && p.end > p.start
    )
    const styleId =
      body.styleId && body.styleId in STYLE_PRESETS ? (body.styleId as StylePresetId) : null

    if (!videos.length || !phrases.length) {
      return NextResponse.json({ error: COPY.exportFail }, { status: 400 })
    }

    // Solo archivos que existen
    const existing: { id: string }[] = []
    for (const v of videos) {
      if (await fileExists(uploadsPath(v.id))) existing.push(v)
    }
    if (!existing.length) {
      return NextResponse.json({ error: COPY.exportFail }, { status: 400 })
    }

    // Metadatos por video (duración real, audio sí/no) en paralelo.
    // La duración la decide ffprobe, no el cliente ni Whisper.
    const probes = await Promise.all(
      existing.map((v) => probeVideo(uploadsPath(v.id)))
    )
    const hasAudioByVideo = new Map(existing.map((v, i) => [v.id, probes[i].hasAudio]))
    const fpsByVideo = new Map(existing.map((v, i) => [v.id, probes[i].fps]))

    const segments = buildCutSegments(
      existing.map((v, i) => ({ id: v.id, duration: probes[i].duration, fps: probes[i].fps })),
      phrases
    )
    if (!segments.length) {
      return NextResponse.json({ error: COPY.exportFail }, { status: 400 })
    }
    const totalTl = totalDuration(segments)
    // Lienzo con el aspecto del primer video (sin deformar ni recortar).
    // Los demás videos se encajan dentro con margen si tienen otro aspecto.
    const canvas = canvasFor(probes[0].width, probes[0].height)
    const { w: W, h: H } = canvas

    exportDir = exportDirPath(exportId)
    await mkdir(exportDir, { recursive: true })

    // ---- ASS ----
    let hasAss = false
    if (styleId) {
      const cues = buildCues(styleId, phrases, segments)
      await writeFile(`${exportDir}/style.ass`, buildAss(styleId, cues, totalTl, canvas, {
          outline: body.outline === true,
          offset: clampOffset(body.textOffset),
          imageLayers: (body.imageLayers ?? []).filter((l) => l.type === 'image' && l.enabled !== false),
        }), 'utf-8')
      hasAss = true
    }

    // ---- Imágenes activas ----
    const activeImages: { layer: Layer; path: string }[] = []
    for (const layer of body.imageLayers ?? []) {
      if (layer.type !== 'image' || layer.enabled === false || !layer.src) continue
      if (!IMAGE_RE.test(layer.src)) continue
      const p = uploadsPath(layer.src)
      if (await fileExists(p)) {
        activeImages.push({ layer, path: p })
      }
    }

    // Cada imagen activa debe decodificarse. Una imagen corrupta dejaba a ffmpeg
    // esperando fotogramas para siempre: se falla rápido, sin saltarla en silencio.
    const uniquePaths = [...new Set(activeImages.map((img) => img.path))]
    const decodable = await Promise.all(uniquePaths.map((p) => probeImage(p)))
    const broken = uniquePaths.filter((_, i) => !decodable[i])
    if (broken.length) {
      throw new Error(`imagen de apoyo no decodificable (${broken.length})`)
    }

    // ---- ffmpeg ----
    const args: string[] = ['-y']
    const parts: string[] = []
    const concatParts: string[] = []
    let inputIdx = 0
    let segCount = 0

    // segmentos mantenidos agrupados por video, en orden de línea de tiempo
    const byVideo = new Map<string, typeof segments>()
    for (const s of segments) {
      const list = byVideo.get(s.videoId) ?? []
      list.push(s)
      byVideo.set(s.videoId, list)
    }

    for (const v of existing) {
      const segs = byVideo.get(v.id)
      if (!segs?.length) continue
      const vi = inputIdx++
      args.push('-i', uploadsPath(v.id))
      const hasAudio = hasAudioByVideo.get(v.id) !== false
      // Los bordes ya están en la rejilla de fotogramas: trim se corre medio
      // fotograma para tomar exactamente los fotogramas [inicio, fin) sin
      // depender del redondeo de los timestamps.
      const half = 0.5 / (fpsByVideo.get(v.id) || 30)
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k]
        const vStart = s.srcStart > 0 ? s.srcStart - half : 0
        // encaje por segmento: concat necesita el mismo tamaño en todos
        parts.push(
          `[${vi}:v]trim=start=${f6(vStart)}:end=${f6(s.srcEnd - half)},setpts=PTS-STARTPTS,` +
            `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
            `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${vi}_${k}]`
        )
        if (hasAudio) {
          parts.push(
            `[${vi}:a]atrim=start=${f6(s.srcStart)}:end=${f6(s.srcEnd)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${vi}_${k}]`
          )
        } else {
          parts.push(
            `anullsrc=r=48000:cl=stereo,atrim=duration=${f6(s.srcEnd - s.srcStart)},asetpts=PTS-STARTPTS[a${vi}_${k}]`
          )
        }
        concatParts.push(`[v${vi}_${k}]`, `[a${vi}_${k}]`)
        segCount++
      }
    }

    parts.push(
      `${concatParts.join('')}concat=n=${segCount}:v=1:a=1[catv][cata]`,
      `[catv]fps=30[base]`,
      `[cata]aformat=sample_fmts=fltp:channel_layouts=stereo[aud]`
    )

    let cur = 'base'
    for (let j = 0; j < activeImages.length; j++) {
      const { layer, path } = activeImages[j]
      const wPct = clamp(layer.width ?? 40, 2, 100)
      const hPct = clamp(layer.height ?? 21, 2, 100)
      const wPx = Math.round((W * wPct) / 100)
      const hPx = Math.round((H * hPct) / 100)
      const xPx = Math.round(clamp(((layer.x ?? 50) / 100) * W - wPx / 2, 0, W - wPx))
      const yPx = Math.round(clamp(((layer.y ?? 78) / 100) * H - hPx / 2, 0, H - hPx))
      const start = clamp(layer.start ?? 0, 0, totalTl)
      const end = clamp(layer.end ?? Math.min(3, totalTl), start + 0.1, totalTl)
      const ii = inputIdx++
      // La imagen es una entrada infinita: shortest=1 hace que el overlay termine
      // con el video base. Sin eso, el overlay seguía hasta el fin de la imagen
      // repitiendo el último fotograma (la cola de ~0.4 s con subtítulo).
      args.push('-loop', '1', '-framerate', '30', '-i', path)
      parts.push(`[${ii}:v]scale=${wPx}:${hPx},format=rgba[img${j}]`)
      parts.push(
        `[${cur}][img${j}]overlay=x=${xPx}:y=${yPx}:shortest=1:eof_action=pass:enable='between(t,${f(start)},${f(end)})'[ovl${j}]`
      )
      cur = `ovl${j}`
    }

    if (hasAss) {
      parts.push(`[${cur}]subtitles=style.ass,format=yuv420p[vout]`)
    } else {
      parts.push(`[${cur}]format=yuv420p[vout]`)
    }

    args.push(
      '-filter_complex', parts.join(';'),
      '-map', '[vout]', '-map', '[aud]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      'out.mp4'
    )

    await runFfmpeg(args, exportDir, exportTimeoutMs(totalTl))

    // La usuaria cerró o canceló mientras ffmpeg trabajaba: nadie leerá el archivo.
    if (req.signal.aborted) {
      await removeExportDir(exportDir)
      return new Response(null, { status: 499 })
    }

    // La carpeta se borra cuando el archivo termina de enviarse o la descarga se
    // cancela: 'close' llega en ambos casos, ya con el archivo cerrado.
    const file = createReadStream(`${exportDir}/out.mp4`)
    const dirToRemove = exportDir
    file.once('close', () => {
      void removeExportDir(dirToRemove)
    })
    req.signal.addEventListener('abort', () => file.destroy(), { once: true })
    handedOff = true
    const stream = Readable.toWeb(file) as ReadableStream<Uint8Array>
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="video-editado.mp4"',
      },
    })
  } catch (err) {
    console.error('[export] error:', err instanceof Error ? err.message : err)
    if (exportDir && !handedOff) await removeExportDir(exportDir)
    return NextResponse.json({ error: COPY.exportFail }, { status: 500 })
  }
}
