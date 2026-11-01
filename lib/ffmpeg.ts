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
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
}

/** Sondea el video: dimensiones, duración y si tiene pista de audio. */
export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,width,height',
        '-show_entries', 'format=duration',
        '-of', 'json',
        filePath,
      ],
      { env: getSpawnEnv() }
    )
    let stdout = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    const fallback: ProbeResult = { width: 1080, height: 1920, duration: 0, hasAudio: true }
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
        resolve({
          width: video?.width ?? 1080,
          height: video?.height ?? 1920,
          duration: parseFloat(json.format?.duration ?? '0') || 0,
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
