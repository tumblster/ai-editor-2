// Rutas y validación de archivos en uploads/ — SOLO servidor.

import { readdir, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'

export const UPLOADS_DIR = join(process.cwd(), 'uploads')
export const TMP_DIR = join(UPLOADS_DIR, 'tmp')

export const VIDEO_RE = /^[a-f0-9-]{36}\.(mp4|mov|m4v|webm|mkv)$/i
export const IMAGE_RE = /^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/i
export const ANY_FILE_RE = /^[a-f0-9-]{36}\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp|gif)$/i

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024

export function uploadsPath(fileName: string): string {
  return join(UPLOADS_DIR, fileName)
}

// ---- Carpetas temporales de export: uploads/export-<id>/ ----

const EXPORT_DIR_RE = /^export-[a-f0-9]{8}$/
export const EXPORT_MAX_AGE_MS = 60 * 60 * 1000 // 1 hora

export function exportDirPath(exportId: string): string {
  return join(UPLOADS_DIR, `export-${exportId}`)
}

/** Borra una carpeta de export. Solo actúa sobre uploads/export-<id>, nunca otra ruta. */
export async function removeExportDir(dir: string): Promise<void> {
  if (dirname(dir) !== UPLOADS_DIR || !EXPORT_DIR_RE.test(basename(dir))) return
  await rm(dir, { recursive: true, force: true }).catch((err) => {
    console.error('[export] no se pudo borrar la carpeta temporal:', err instanceof Error ? err.message : err)
  })
}

/**
 * Mantenimiento: borra las carpetas de export con más de `maxAgeMs`.
 * Cubre las que quedaron si el servidor se cortó a mitad de un export o de una descarga.
 */
export async function sweepStaleExports(maxAgeMs = EXPORT_MAX_AGE_MS): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(UPLOADS_DIR)
  } catch {
    return
  }
  const now = Date.now()
  await Promise.all(
    entries
      .filter((name) => EXPORT_DIR_RE.test(name))
      .map(async (name) => {
        const dir = join(UPLOADS_DIR, name)
        try {
          const { mtimeMs } = await stat(dir)
          if (now - mtimeMs > maxAgeMs) await removeExportDir(dir)
        } catch {
          /* ya no existe */
        }
      })
  )
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
