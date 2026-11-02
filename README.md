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
- lo que marca el autorrecorte (sin tocar el original),
- los segmentos alineados a fotograma y recortados a la duración real del video,
- los cues,
- sombra, contorno y el aviso de contraste,
- el archivo ASS,
- el rechazo rápido de imágenes corruptas,
- el tiempo máximo de ffmpeg.

Las dos últimas usan el `ffmpeg`/`ffprobe` del sistema.

Sale con código 1 si alguna falla.

## Archivos de export

Cada export se arma en `uploads/export-<id>/` (en `.gitignore`):

- La carpeta se borra cuando termina la descarga, o si el export falla.
- Antes de correr ffmpeg, cada imagen de apoyo activa se comprueba con ffprobe: tiene que decodificarse. Una imagen corrupta hace fallar el export con el mensaje cerrado, en lugar de dejar a ffmpeg colgado.
- ffmpeg tiene un tiempo máximo de 2 min + 8 s por segundo exportado. Si lo supera, se mata, se borra la carpeta y el export falla con el mensaje cerrado.
- Al empezar cada export, también se borran las carpetas `export-*` con más de 1 hora. Así se limpian las que quedaron por un corte del servidor.
