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
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
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
 * Sondea el video: dimensiones (como se ven, ya giradas), duración y si tiene pista de audio.
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
        '-show_entries',
        'stream=codec_type,width,height,duration,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation',
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
        // Videos de móvil: vienen codificados en horizontal con una rotación de
        // 90°. ffmpeg y el navegador los giran al reproducir, así que el ancho y
        // el alto que importan son los girados.
        const rotation = Math.abs(
          Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0)
        )
        const turned = Math.round(rotation / 90) % 2 === 1
        const w = video?.width ?? 1080
        const h = video?.height ?? 1920
        resolve({
          width: turned ? h : w,
          height: turned ? w : h,
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

/**
 * Comprueba que una imagen se pueda decodificar de verdad (ffprobe decodifica el
 * primer fotograma). ffprobe sale con código 0 aunque la imagen esté corrupta,
 * así que se exige un fotograma leído con ancho y alto. Si no, ffmpeg se queda
 * esperando fotogramas de esa imagen para siempre durante el export.
 */
export function probeImage(filePath: string, timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-count_frames',
        '-show_entries', 'stream=width,height,nb_read_frames',
        '-of', 'json',
        filePath,
      ],
      { env: getSpawnEnv() }
    )
    let stdout = ''
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      done(false)
    }, timeoutMs)
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.on('error', () => done(false))
    proc.on('close', (code) => {
      if (code !== 0) return done(false)
      try {
        const s = (JSON.parse(stdout) as {
          streams?: { width?: number; height?: number; nb_read_frames?: string }[]
        }).streams?.[0]
        done(!!s && (s.width ?? 0) > 0 && (s.height ?? 0) > 0 && parseInt(s.nb_read_frames ?? '0', 10) >= 1)
      } catch {
        done(false)
      }
    })
  })
}

/**
 * Tiempo máximo de ffmpeg: 2 min fijos + 8 s por cada segundo de video
 * exportado (1080x1920 con libx264 veryfast en un PC modesto va bastante más
 * rápido). Si se supera, ffmpeg se mata y el export falla con el mensaje cerrado.
 */
export function exportTimeoutMs(totalSeconds: number): number {
  return 120_000 + Math.ceil(Math.max(0, totalSeconds) * 8_000)
}

export class FfmpegTimeoutError extends Error {
  constructor(ms: number) {
    super(`ffmpeg superó el tiempo máximo (${Math.round(ms / 1000)} s)`)
    this.name = 'FfmpegTimeoutError'
  }
}

export class FfmpegStallError extends Error {
  constructor(ms: number) {
    super(`ffmpeg no mostró progreso en ${Math.round(ms / 1000)} s`)
    this.name = 'FfmpegStallError'
  }
}

/** Sin progreso de ffmpeg durante este tiempo, el export se corta. */
export const EXPORT_STALL_MS = 60_000

export interface RunFfmpegOptions {
  /** Techo de seguridad: tiempo máximo total. */
  timeoutMs?: number
  /**
   * Watchdog: si ffmpeg no muestra progreso (tiempo de salida, fotogramas o
   * tamaño escrito) durante este tiempo, se mata. Usa `-progress pipe:1`.
   */
  stallMs?: number
}

/**
 * Corre ffmpeg con un log de servidor; rechaza con el stderr final si falla.
 * Si supera `timeoutMs` o pasa `stallMs` sin progreso, se mata (SIGTERM y, si
 * no responde, SIGKILL) y se rechaza cuando el proceso ya salió — así la
 * carpeta de trabajo se puede borrar sin archivos abiertos.
 */
export function runFfmpeg(
  args: string[],
  cwd?: string,
  opts: number | RunFfmpegOptions = {}
): Promise<void> {
  const { timeoutMs, stallMs } = typeof opts === 'number' ? { timeoutMs: opts, stallMs: undefined } : opts
  const fullArgs = stallMs && stallMs > 0 ? ['-progress', 'pipe:1', '-nostats', ...args] : args
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', fullArgs, { env: getSpawnEnv(), cwd })
    let stderr = ''
    let killedFor: Error | null = null
    let hardKill: ReturnType<typeof setTimeout> | undefined

    const stop = (reason: Error) => {
      if (killedFor) return
      killedFor = reason
      proc.kill('SIGTERM')
      hardKill = setTimeout(() => proc.kill('SIGKILL'), 3_000)
    }

    const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => stop(new FfmpegTimeoutError(timeoutMs)), timeoutMs) : undefined

    // ---- watchdog de progreso ----
    let lastProgressAt = Date.now()
    let lastMark = ''
    let finishing = false // progress=end: ffmpeg cierra el archivo (faststart), ya no reporta
    let block: Record<string, string> = {}
    let pending = ''
    const watchdog =
      stallMs && stallMs > 0
        ? setInterval(() => {
            if (!finishing && Date.now() - lastProgressAt > stallMs) stop(new FfmpegStallError(stallMs))
          }, Math.min(1_000, stallMs / 2))
        : undefined
    proc.stdout.on('data', (d) => {
      if (!watchdog) return
      pending += d.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        block[key] = value
        if (key !== 'progress') continue
        const mark = `${block.out_time_us ?? ''}|${block.frame ?? ''}|${block.total_size ?? ''}`
        if (mark !== lastMark) {
          lastMark = mark
          lastProgressAt = Date.now()
        }
        if (value === 'end') finishing = true
        block = {}
      }
    })

    proc.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 64_000) stderr = stderr.slice(-16_000)
    })
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (hardKill) clearTimeout(hardKill)
      if (watchdog) clearInterval(watchdog)
    }
    proc.on('close', (code) => {
      cleanup()
      if (killedFor) {
        console.error(`[ffmpeg] detenido: ${killedFor.message}`)
        reject(killedFor)
      } else if (code === 0) resolve()
      else {
        console.error('[ffmpeg] exit', code, 'última línea:', stderr.split('\n').slice(-6).join(' | '))
        reject(new Error(`ffmpeg exited with code ${code}`))
      }
    })
    proc.on('error', (err) => {
      cleanup()
      console.error('[ffmpeg] spawn error', err)
      reject(err)
    })
  })
}
