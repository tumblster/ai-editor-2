// Lienzo del proyecto: mismo aspecto que el video subido, sin deformar ni recortar.
// Compartido por preview (cliente) y export (servidor) para que coincidan.
// El lado corto mide 1080 px; 9:16 (1080x1920) es el caso normal de reels.
// Los tamaños de texto de los estilos están en px sobre ese lado corto, y las
// posiciones en % del lienzo.

export interface Canvas {
  w: number
  h: number
}

export const CANVAS_SHORT_SIDE = 1080
export const DEFAULT_CANVAS: Canvas = { w: 1080, h: 1920 }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Lienzo para un video de `width` x `height` (dimensiones ya giradas, como se ven). */
export function canvasFor(width?: number, height?: number): Canvas {
  if (!width || !height || width <= 0 || height <= 0) return DEFAULT_CANVAS
  if (width <= height) return { w: CANVAS_SHORT_SIDE, h: even((CANVAS_SHORT_SIDE * height) / width) }
  return { w: even((CANVAS_SHORT_SIDE * width) / height), h: CANVAS_SHORT_SIDE }
}

/**
 * Encaje sin recorte (contain) de un video vw x vh dentro del lienzo: escala y
 * margen. Es lo mismo que hace el export (scale decrease + pad centrado) y el
 * preview (object-fit: contain).
 */
export function containFit(canvas: Canvas, vw: number, vh: number) {
  const s = Math.min(canvas.w / vw, canvas.h / vh)
  return { s, ox: (canvas.w - vw * s) / 2, oy: (canvas.h - vh * s) / 2 }
}
