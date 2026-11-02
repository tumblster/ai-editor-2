// ffmpeg/ffprobe nativos locales — SOLO servidor.
// En Windows, el servidor de Next no siempre hereda el PATH de WinGet Links;
// se agrega explícitamente para encontrar ffmpeg instalado con winget.

import { spawn } from 'child_process'
import { join } from 'path'

export function getSpawnEnv(): NodeJS.ProcessEnv {
  const userWinGet = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
    : ''
  const currentPath = process.env.PATH || ''
  const enrichedPath =
    userWinGet && !currentPath.toLowerCase().includes(userWinGet.toLowerCase())
      ? `${currentPath};${userWinGet}`
      : currentPath
  return { ...process.env, PATH: enrichedPath }
}

export interface ProbeResult {
  width: number
  height: number
  duration: number
  fps: number
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
  avg_frame_rate?: string
  r_frame_rate?: string
}

function parseRate(rate?: string): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  const v = d ? n / d : n
  return Number.isFinite(v) && v >= 1 && v <= 240 ? v : 0
}

/**
 * Sondea el video: dimensiones, duración y si tiene pista de audio.
 * La duración es la de la pista de video (lo que el export puede mostrar):
 * el contenedor puede declarar más si el audio es más largo, y Whisper puede
 * devolver palabras que terminan después del último fotograma.
 */
export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,width,height,duration,avg_frame_rate,r_frame_rate',
        '-show_entries', 'format=duration',
        '-of', 'json',
        filePath,
      ],
      { env: getSpawnEnv() }
    )
    let stdout = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    const fallback: ProbeResult = { width: 1080, height: 1920, duration: 0, fps: 30, hasAudio: true }
    proc.on('close', (code) => {
      if (code !== 0 || !stdout) {
        resolve(fallback)
        return
      }
      try {
        const json = JSON.parse(stdout) as {
          streams?: FfprobeStream[]
          format?: { duration?: string }
        }
        const video = (json.streams ?? []).find((s) => s.codec_type === 'video')
        const formatDur = parseFloat(json.format?.duration ?? '0') || 0
        const videoDur = parseFloat(video?.duration ?? '0') || 0
        resolve({
          width: video?.width ?? 1080,
          height: video?.height ?? 1920,
          duration: videoDur > 0 ? (formatDur > 0 ? Math.min(videoDur, formatDur) : videoDur) : formatDur,
          fps: parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate) || 30,
          hasAudio: (json.streams ?? []).some((s) => s.codec_type === 'audio'),
        })
      } catch {
        resolve(fallback)
      }
    })
    proc.on('error', () => resolve(fallback))
  })
}

/** Extrae audio mono 16 kHz para enviar a Groq (los videos grandes no entran directos). */
export function extractAudio(filePath: string, outPath: string): Promise<void> {
  return runFfmpeg(['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', outPath])
}

/** Corre ffmpeg con un log de servidor; rechaza con el stderr final si falla. */
export function runFfmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { env: getSpawnEnv(), cwd })
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else {
        console.error('[ffmpeg] exit', code, 'última línea:', stderr.split('\n').slice(-6).join(' | '))
        reject(new Error(`ffmpeg exited with code ${code}`))
      }
    })
    proc.on('error', (err) => {
      console.error('[ffmpeg] spawn error', err)
      reject(err)
    })
  })
}
