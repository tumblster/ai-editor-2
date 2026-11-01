// Copy cerrada — la usan servidor y cliente. No se inventan textos nuevos.

export const COPY = {
  invalidFile: 'El archivo no es válido. Sube un video de menos de 500 MB.',
  transcribeFail: 'No se pudo transcribir el video. Intenta de nuevo.',
  exportFail: 'No se pudo exportar. Intenta de nuevo.',
  rateLimited: 'Demasiadas solicitudes. Espera un momento.',
} as const
