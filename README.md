# ai-editor-2

Editor de video para creadoras. El spec es `PLAN.md` y las reglas de la casa están en `CLAUDE.md`.

## Desarrollo local

```bash
npm install
```

```bash
npm run dev
```

Requiere `ffmpeg` y `ffprobe` en el PATH, y `GROQ_API_KEY` en `.env.local` (nunca en el repo).

## Pruebas de lógica

```bash
npm test
```

Corre `scripts/test-logic.cjs`, sin dependencias extra:

1. Compila `lib/` con el `tsc` del proyecto en una carpeta temporal del sistema, fuera del repo.
2. Ejecuta `tests/logic.test.cjs` con las transcripciones de prueba de `testmedia/`.
3. Borra la carpeta temporal.

Cubren:

- frases de hasta 5 palabras y la partición del video,
- el resumen del autorrecorte,
- los segmentos alineados a fotograma y recortados a la duración real del video,
- los cues,
- la regla de contraste,
- el archivo ASS.

Sale con código 1 si alguna falla.

## Archivos de export

Cada export se arma en `uploads/export-<id>/` (en `.gitignore`):

- La carpeta se borra cuando termina la descarga, o si el export falla.
- Al empezar cada export, también se borran las carpetas `export-*` con más de 1 hora. Así se limpian las que quedaron por un corte del servidor.
