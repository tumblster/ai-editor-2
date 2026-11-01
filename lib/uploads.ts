// Rutas y validación de archivos en uploads/ — SOLO servidor.

import { stat } from 'fs/promises'
import { join } from 'path'

export const UPLOADS_DIR = join(process.cwd(), 'uploads')
export const TMP_DIR = join(UPLOADS_DIR, 'tmp')

export const VIDEO_RE = /^[a-f0-9-]{36}\.(mp4|mov|m4v|webm|mkv)$/i
export const IMAGE_RE = /^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/i
export const ANY_FILE_RE = /^[a-f0-9-]{36}\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp|gif)$/i

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024

export function uploadsPath(fileName: string): string {
  return join(UPLOADS_DIR, fileName)
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export function mimeByExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  }
  return map[ext] ?? 'application/octet-stream'
}
