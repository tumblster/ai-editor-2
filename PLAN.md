# PLAN.md — Spec de Fase 1

> Este archivo ES el spec de la Fase 1. No se escribe código hasta que el arquitecto apruebe este plan.

---

## Qué se construye

Una pantalla web (`app/page.tsx`, ruta raíz) que permite:

1. **Subir uno o más videos** desde el dispositivo del usuario (máx. 500 MB por video, solo video), en el orden en que se suben, y añadir más videos después con un botón **+**; también **imágenes propias de apoyo** (solo imagen) que se usan como recursos en el video final
2. **Enviar cada video a Groq Whisper** (`whisper-large-v3-turbo`) desde el servidor — nunca desde el navegador
3. **Recibir la transcripción** con tiempos por palabra y por segmento (`verbose_json`), un `transcription.json` por video
4. **Mostrar la transcripción de todos los videos en orden**, agrupada en frases de 3 a 5 palabras máximo, sincronizadas con el video; cada frase es una unidad que se puede quitar o restaurar, y si una frase hablada es más larga se parte por palabras, nunca a mitad de palabra
5. **Aplicar un autorrecorte** (silencios, muletillas, repeticiones) — sin modal de confirmación; lo que lo hace seguro es poder deshacer, rehacer y restaurar después
6. **Editar en una línea de tiempo fluida (60 fps)** con pistas de video, texto e imagen, cortes manuales, ajuste de bordes arrastrando, deshacer y rehacer
7. **Colocar las imágenes propias** como capas sobre el video — posición, tamaño, tiempo y toggle — quemadas en el export con ffmpeg
8. **Elegir un estilo predefinido** (Chispa, Revista, Titular, Claro, Foco) para quemar en el export
9. **Exportar el video cortado** con ffmpeg nativo local — con estilo e imágenes, o limpio si no se elige ninguno

Sin chat AI. Todo lo automático se controla con botones o checks. El chat para editar queda para después, cuando el motor de cortes esté probado con videos reales.

---

## Fuera de alcance en Fase 1

- ❌ Subtítulos personalizables nivel Premiere (Fase 2)
- ❌ Sistema completo de Looks: guardar, duplicar, editar (Fase 2)
- ❌ Banco de imágenes propio (Fase 1.5)
- ❌ Biblioteca de sonidos con archivos (Fase 1.5)
- ❌ Música completa
- ❌ Chat AI para editar
- ❌ Autenticación de usuarias
- ❌ Worker alojado (el export usa ffmpeg nativo local, no en el navegador, no en servidor remoto)
- ❌ Subir el video a ningún servicio externo
- ❌ Integraciones con Drive, iCloud o subida por QR en Fase 1

Los estilos predefinidos, el autorrecorte, la línea de tiempo, las imágenes propias y el export **sí van en Fase 1**.

---

## Fase 1.5 — definida, pendiente de construir

Después de que Fase 1 pase con videos reales:

- **Banco de imágenes propio** — sin licencia, con favoritos, colocación manual y por IA
- **Biblioteca de sonidos cortos** — por evento (corte, entrada, etc.), con archivos originales o con licencia comercial; nunca sonidos copiados de TikTok o Instagram para exportar a clientes

El terreno para Fase 1.5 se prepara en Fase 1 (ver sección de modelo de capas más abajo), pero los archivos y la UI de banco/biblioteca **no se construyen todavía**.

---

## Piezas que toca la Fase 1

### 1. `app/api/upload/route.ts`
- Recibe uno o más archivos vía `multipart/form-data` (videos y/o imágenes propias)
- Valida: tipo MIME (solo video para videos, solo imagen para imágenes), tamaño máximo **500 MB por video**
- Guarda cada archivo en `uploads/` (excluida del repo en `.gitignore`)
- Devuelve los `fileId` en el orden de subida, con tipo (video o imagen) y metadatos (duración, dimensiones)
- Rate limiting por IP desde el inicio
- Mensaje de error cerrado si el archivo no es válido (ver sección de copy)

### 2. `app/api/transcribe/route.ts`
- Recibe el `fileId` de un video — cada video se transcribe por separado
- Lee el archivo del disco en el servidor
- Llama a Groq con `whisper-large-v3-turbo` y `response_format: verbose_json` para tiempos por palabra y por segmento
- Lee `GROQ_API_KEY` desde variable de entorno del servidor — nunca del cliente
- Guarda `transcription.json` por video junto al archivo en `uploads/`
- Devuelve la transcripción estructurada al frontend
- **No elimina el video después de transcribir** — se conserva hasta que el usuario exporte o cierre el proyecto; la limpieza ocurre al finalizar sesión o en un job de mantenimiento periódico
- Rate limiting por IP desde el inicio

### 3. `app/api/export/route.ts`
- Recibe la lista de segmentos activos (qué se queda, qué se quita), las imágenes activas y el estilo elegido (o ninguno)
- Construye el comando ffmpeg con los segmentos usando `concat` o filtros de tiempo
- Si hay estilo elegido, quema el texto sobre el video con ASS y libass usando los parámetros del estilo — el texto viene de la transcripción
- Si hay imágenes activas, las superpone en su posición, tamaño y tiempo con ffmpeg
- Si no hay estilo, exporta el video cortado limpio (con imágenes si las hay), sin texto
- Ejecuta ffmpeg nativo local (no ffmpeg.wasm, no worker remoto)
- El MP4 tiene el aspecto del video subido (ver «Aspecto del video»)
- Antes de correr ffmpeg comprueba con ffprobe que cada imagen activa se pueda decodificar; si no, falla con el mensaje cerrado
- **Watchdog:** si ffmpeg pasa 60 segundos sin progreso, se mata, se borra la carpeta del export y se devuelve el mensaje cerrado. Se mantiene un tiempo máximo total como techo de seguridad (2 min + 8 s por segundo exportado). El preset de calidad no cambia
- Devuelve el archivo exportado o un stream de descarga
- Rate limiting por IP desde el inicio
- Mensaje de error legible sin exponer detalles internos del servidor

### 4. Almacenamiento local temporal
- Video en `uploads/` — en `.gitignore`
- Transcripción y estado del proyecto (lista de cortes, estilo elegido, settings) en JSON local junto al video
- `localStorage` o cookies del navegador **solo** para settings y preferencias del usuario (no para el video)
- No hay base de datos en Fase 1

### 5. `app/page.tsx` — pantalla principal (única ruta, no `app/editor/page.tsx`)

Estados de UI requeridos:

| Estado | Qué muestra |
|--------|-------------|
| Vacío | Zona drag-and-drop + botón **Subir video**; con archivos elegidos, botón **Editar mi video** |
| Cargando (subida) | Indicador de progreso de subida |
| Cargando (transcripción) | Indicador de progreso de transcripción |
| Éxito | Video · Transcripción · Línea de tiempo · Panel de autorrecorte · Selector de estilos · Imágenes de apoyo · Botón Exportar |
| Cargando (export) | Indicador de progreso de export |
| Error | Mensaje del copy cerrado — sin detalles internos del servidor |

### 6. Componentes principales

| Componente | Responsabilidad |
|-----------|----------------|
| `VideoUploader.tsx` | Drag-and-drop o input de archivo, subida múltiple en orden (videos e imágenes), botón **+** para añadir más; estados vacío, cargando subida, cargando transcripción, error |
| `TranscriptionView.tsx` | Frases de 3–5 palabras con tiempos; frases quitadas marcadas visualmente |
| `AutocutPanel.tsx` | Botón dividido: **Autorrecorte** aplica directo y la flecha abre el desplegable con los interruptores **Silencios**, **Muletillas** y **Repeticiones**; el resultado se avisa con el toast **Autorrecorte listo** |
| `Timeline.tsx` | Línea de tiempo fluida a 60 fps (`requestAnimationFrame`) con pistas de video, texto e imagen; segmentos clicables, ajuste de bordes arrastrando inicio/fin, cabezal arrastrable sin tirones |
| `StylePicker.tsx` | Selector de estilos con layout de tarjetas: barra de 5 segmentos arriba, tarjetas con fotograma y frase reales, check **Contorno**, **Back** y **Next** abajo (ver «Selector de estilos») |
| `ExportButton.tsx` | Botón **Exportar** con estados cargando y error |

### 7. `lib/groq.ts`
- Cliente Groq — importado **solo** en rutas de servidor
- Lee `GROQ_API_KEY` desde `process.env`
- Nunca se expone al cliente ni se importa desde componentes

---

## Terreno preparado en Fase 1 para Fase 1.5 (imágenes y sonidos)

La línea de tiempo y el modelo de datos de Fase 1 se diseñan para que en Fase 1.5 se conecten imágenes y sonidos **sin reescribir la línea de tiempo**.

**Modelo de capa (en el JSON de estado del proyecto):**
```ts
type Layer = {
  id: string
  type: 'video' | 'image' | 'audio' | 'text'
  src?: string          // ruta local del archivo (Fase 1.5 en adelante)
  start: number         // tiempo de inicio en segundos
  end: number           // tiempo de fin en segundos
  order: number         // z-index / orden en la pila de capas
  // Para imagen:
  x?: number            // posición horizontal (% del ancho)
  y?: number            // posición vertical (% del alto)
  width?: number        // ancho (% del ancho del video)
  height?: number       // alto (% del alto del video)
  // Para audio:
  volume?: number       // 0–1
  muted?: boolean
  // Para texto (estilos predefinidos):
  style?: StylePresetId
  text?: string
}
```

**En Fase 1 se construye:**
- La pista de video (con los cortes), la pista de texto (el estilo predefinido) y la pista de imagen (imágenes propias subidas por la usuaria) en la estructura y en la línea de tiempo
- El tipo `audio` existe en el modelo de datos pero no tiene UI ni archivos todavía

**En Fase 1.5 se conecta:**
- La UI para agregar imágenes desde el banco propio a la pista `image`
- La UI para agregar sonidos desde la biblioteca a la pista `audio`
- Sin reescribir `Timeline.tsx` — solo agregando los handlers de los nuevos tipos

---

## Estilos predefinidos en Fase 1

Estos estilos son seleccionables con un botón cada uno. **No hay edición de fuente ni tamaño en Fase 1.** Sí se puede, por decisión del usuario:
- **Mover el bloque de texto completo** de cada estilo arrastrándolo en el reproductor, igual que una imagen. La posición se guarda por estilo como desplazamiento en % del lienzo, entra en Deshacer/Rehacer y el export la respeta. En Revista se mueven los bloques de texto; la banda vertical es decoración y queda fija.
- **Activar el contorno** del estilo con el check **Contorno** (ver «Sombra y contorno»).

Guardar, duplicar y editar un Look propio queda para Fase 2.

**Los cinco estilos usan nombres públicos exactos — Chispa, Revista, Titular, Claro, Foco — y nunca nombres de creadores, ni en la UI, ni en los slugs de código, ni en marketing.**

El selector usa un layout de tarjetas (ver «Selector de estilos» más abajo): la vista previa es el reproductor, y cada tarjeta repite el mismo fotograma real del clip con un estilo distinto. Los botones Back y Next las recorren.

Si el usuario no elige ningún estilo, el export es el video cortado limpio, sin texto.

### Chispa
- Grupos de 1–3 palabras
- Sans gruesa redondeada, color crema
- Sombra oscura suave
- Centrado en el tercio superior: 28–35% desde arriba
- Entrada y salida por corte duro
- Palabra de énfasis en MAYÚSCULAS y más grande

### Revista
- Serif blanca con sombra suave
- Dos bloques: izquierdo 8–38% del ancho, derecho 60–85% del ancho
- Banda vertical 35–45% del ancho
- Evita la cara

### Titular
- Sans blanca centrada, 47–52% desde arriba
- Palabra clave en serif cursiva amarilla, grande
- **Siempre con sombra o contorno oscuro** — regla de contraste aplicada
- Solo texto en Fase 1 — sin video rectangular superpuesto

### Claro
- Sans negrita blanca centrada, 57–62% desde arriba
- Palabra clave en amarillo pálido con sombra suave

### Foco
- Sans redondeada negrita blanca, centrada debajo de la cara sobre el pecho
- Subtitulado simple: sin sombra ni contorno por defecto; el contorno oscuro fino se activa con el check **Contorno**
- Número o dato destacado en amarillo, siempre con sombra (palabra de énfasis)
- Si una imagen de apoyo choca con el texto, la imagen va detrás y el texto encima con sombra

### Sombra y contorno (decisión del usuario)
- **Sombra activa por defecto** en títulos y textos grandes (Chispa, Revista, Titular) y en las palabras de énfasis de todos los estilos. **Apagada** en subtitulado simple (Claro, Foco).
- **Contorno opcional por estilo, apagado por defecto.** Por defecto solo hay sombra y el contorno no se dibuja.
- El check **Contorno** del selector se puede marcar en los 5 estilos, incluidos Chispa, Revista y Titular. En Claro y Foco, sin sombra por defecto, también enciende el contorno.
- **Contorno y sombra a la vez:** con el check encendido se dibuja un **contorno fino detrás de la sombra**, y la sombra sigue prevaleciendo visualmente. El grosor es de 2 px en Chispa, Revista y Titular y de 2.5 px en Claro y Foco.
  - Cómo se dibuja: en dos capas, en la preview y en el ASS. Abajo va el texto con el contorno y sin sombras; arriba, el mismo texto con sus sombras y sin contorno (`outlineLayers` en `lib/styles/presets.ts`).
- Si una imagen de apoyo choca con el texto (en tiempo y espacio), la imagen va detrás y el texto encima con sombra.
- **No se fuerza contorno por contraste.** El check de contraste mide el fotograma real del preview y avisa (ícono de aviso en el selector de estilo) cuando un texto sin sombra ni contorno no se lee sobre ese fondo. Amarillo plano sin sombra sobre fondo claro siempre se marca.
- Preview y export aplican la misma regla (`resolveStyle` en `lib/styles/presets.ts`).

---

## Cómo funciona el autorrecorte (sin modal de confirmación)

El autorrecorte aplica directo al presionar el botón — como en cualquier editor profesional. Lo que lo hace seguro es poder deshacer, rehacer y restaurar después.

**Paso 1 — Configurar** (decisión del usuario: botón dividido). La flecha a la derecha de **Autorrecorte** abre un desplegable con 3 interruptores, los 3 activos por defecto:
- **Silencios**
- **Muletillas** *(eh, ah, este, o sea, y similares en español)*
- **Repeticiones** *(retakes: frases repetidas; se queda solo el último intento completo, y solo dentro del mismo video en Fase 1, no entre videos consecutivos)*

Detalles del botón dividido:
- El botón **Autorrecorte** muestra con 3 puntos cuántos interruptores están activos, y se deshabilita si no hay ninguno.
- La última elección se guarda en el navegador (solo preferencia) y se mantiene en el siguiente video.
- El desplegable se abre dentro del panel, al tocar la flecha, y se cierra al tocar fuera o con Escape. En móvil no lo tapan el player fijo ni la línea de tiempo.

**Paso 2 — Aplicar:**
El usuario presiona **Autorrecorte**.
La lógica corre en el navegador sobre el JSON de transcripción — sin llamada al servidor.
Se muestra un aviso tipo toast con el texto **Autorrecorte listo**, que se cierra solo a los 5 segundos o al tocarlo. No hay resumen con desglose de segundos, silencios, muletillas ni repeticiones en la UI.
Los segmentos quitados se marcan visualmente en la línea de tiempo y en la transcripción.

**Paso 3 — Ajustar después:**
- Cada segmento quitado tiene un botón **Restaurar** individual
- **Deshacer** y **Rehacer** siempre visibles
- El video original **nunca se toca** — los cortes son solo una lista de qué se queda y qué se quita (no destructivo)

---

## Línea de tiempo y corte manual

- Muestra el video, la transcripción sincronizada y los segmentos, con pista de video, pista de texto y pista de imagen
- Se mueve fluida a 60 fps con `requestAnimationFrame` — sin saltos; el cabezal sigue al video en reproducción y se puede arrastrar sin tirones
- Clic en un segmento: lo quita o lo restaura
- Arrastrando el inicio o el fin de un clip: extiende o contrae ese corte (como en Premiere o CapCut)
- Las etiquetas de los clips no se cortan ni se superponen
- **Deshacer** y **Rehacer** siempre visibles
- El preview refleja la lista de cortes al instante — sin re-codificar; la superposición de estilo e imágenes en preview usa la misma escala, posición, corte de línea, orden de capas y tiempo que el export (lo que se ve es lo que sale en el MP4)

---

## Aspecto del video (decisión del usuario)

- El reproductor y el export **respetan el aspecto del video subido**, sin deformar ni recortar. 9:16 es solo el caso normal de los reels verticales.
- El lienzo del proyecto toma el aspecto del primer video, con el lado corto en 1080 px (9:16 → 1080x1920, 16:9 → 1920x1080, 1:1 → 1080x1080). Si se mezclan aspectos, el video que no coincide con el lienzo queda encajado con barras, sin deformar.
- **Rotación de móvil corregida:** un video de móvil con rotación de 90° sale vertical, no horizontal.
- El texto de los estilos está en px sobre el lado corto del lienzo y las posiciones en % del lienzo, iguales en preview y export.
- El export re-codifica solo al final, una vez

---

## Layout responsive (decisión del usuario)

- **Escritorio (1024 px o más):** preview a la izquierda, opciones a la derecha, línea de tiempo abajo.
- **Móvil y tablet (menos de 1024 px; probado en 768 y 390):**
  - player fijo arriba, a ancho completo, con un máximo del 45% de la altura de la pantalla; nunca a pantalla completa, y con el alto ajustado al aspecto del video;
  - debajo, las opciones de edición y la transcripción, con scroll;
  - al final, la línea de tiempo con el botón **Plegar** / **Desplegar**. El botón solo aparece por debajo de 1024 px; en escritorio la línea de tiempo siempre está visible.
- Sin scroll horizontal en ningún ancho. Las etiquetas de la línea de tiempo solo se muestran si caben enteras, nunca recortadas.

## Selector de estilos (decisión del usuario)

Layout de tarjetas aplicado solo al selector de estilos:
- **Preview:** es el reproductor real, a la izquierda en escritorio y arriba en móvil. No hay una mini-preview aparte.
- **Pasos arriba:** barra de 5 segmentos, uno por estilo, que marca el estilo actual. Sin numeración ni texto.
- **Tarjetas:** cada una repite el mismo fotograma real del clip, con una frase real de la transcripción y su estilo aplicado, y el aspecto del video. Llevan solo el nombre del estilo, sin descripción.
- **Abajo:** el check **Contorno** y los botones **Back** y **Next**. Next pasa al estilo siguiente en el orden Chispa → Revista → Titular → Claro → Foco → sin estilo → Chispa; Back recorre el mismo ciclo al revés. Cada paso aplica el estilo igual que tocar su tarjeta, y tocar la tarjeta del estilo elegido lo quita.
- No hay botón Surprise me.

## Reglas de UI (aplicadas en `app/globals.css`)

- Espaciado solo en 4, 8, 16, 24, 32, 48 y 64.
- Una familia de UI (Inter con respaldos). Cuerpo de 16 px.
- Botones de 52, 44 o 36 px de alto. Un CTA primario por pantalla (en el editor, **Exportar**).
- Movimiento bajo 300 ms, ease-out, solo transform y opacity, nunca desde scale 0, con prefers-reduced-motion.
- Sin gradientes, sin sombras en reposo, sin `transition: all`, sin textos cortados ni desvanecidos, sin eyebrow.
- Copy: solo el copy cerrado de este plan, sin descripciones ni subtítulos nuevos.

---

## Decisiones de arquitectura y por qué

### A. Llave de Groq solo en el servidor
`GROQ_API_KEY` se lee únicamente en `app/api/transcribe/route.ts`. El frontend nunca la recibe ni la transmite.
**Por qué:** Regla de la casa (Sección 4 de CLAUDE.md). Una llave filtrada al cliente expone toda la cuenta.

### B. Tres endpoints separados: upload, transcribe, export
Cada operación es una ruta API distinta con rate limiting independiente.
**Por qué:** Feedback separado al usuario por operación; cada endpoint puede evolucionar o migrar sin afectar los demás.

### C. Almacenamiento temporal en disco local, no en memoria
El video se escribe a `uploads/` antes de enviarlo a Groq.
**Por qué:** Groq acepta archivos. Un video grande en memoria durante el proceso es arriesgado con límites de RAM. Disco local es suficiente para Fases 1–1.5 y siguientes hasta antes del deploy.

### D. No hay base de datos en Fase 1
Sin Postgres, sin SQLite, sin ORM.
**Por qué:** Fase 1 valida el flujo completo. Una base de datos añade complejidad sin valor hasta que haya múltiples usuarias o proyectos simultáneos.

### E. `app/api/` de Next.js — decisión cerrada
No `pages/api/`, no Express separado.
**Por qué:** Next.js App Router es el estándar. Unifica frontend y backend sin configuración extra. El worker separado va aparte solo en la fase de deploy.

### F. Rate limiting desde Fase 1 en los tres endpoints
**Por qué:** Groq tiene tier gratuito con límites. Un loop accidental agota la cuota. El export con ffmpeg consume CPU. Más barato poner el límite desde el inicio.

### G. Lógica de autorrecorte en el navegador
El análisis de silencios, muletillas y retakes corre en el cliente sobre el JSON de transcripción.
**Por qué:** Sin costo de servidor, instantáneo, y la transcripción ya tiene todos los datos necesarios (tiempos, palabras). Si la lógica crece, se puede mover al servidor en una fase posterior sin cambiar la API.

### H. Export con ffmpeg nativo local, no ffmpeg.wasm
**Por qué:** Videos de creadoras pueden ser archivos grandes o grabados con móvil (H.265, HEVC). ffmpeg.wasm tiene límites de memoria en el navegador y no soporta todos los codecs. ffmpeg nativo es más rápido y confiable para Fases 1–1.5 y siguientes.

### I. Video no se elimina tras transcribir
Se mantiene en `uploads/` hasta que el usuario exporte o cierre el proyecto.
**Por qué:** El export necesita el video original. Eliminarlo tras transcribir obligaría a volver a subir.

### J. Modelo de capas preparado desde Fase 1
La estructura de datos de la línea de tiempo incluye los tipos `image` y `audio` desde el inicio, aunque no tengan UI todavía.
**Por qué:** Evita reescribir `Timeline.tsx` en Fase 1.5. El costo es cero: solo un campo `type` en el modelo.

### K. Pantalla en `app/page.tsx` — ruta raíz, no `/editor`
**Por qué:** En Fase 1 hay una sola pantalla. No tiene sentido una ruta `/editor` hasta que haya una pantalla de inicio separada (Fase 2 o posterior).

---

## Copy exacto cerrado — Fase 1

Todo texto de botón, check y título en la UI de Fase 1 usa exactamente estos textos. No se inventan ni agregan otros.

### Botones
| Acción | Copy exacto |
|--------|-------------|
| Subir archivo | **Subir video** |
| Pasar al editor | **Editar mi video** |
| Aplicar autorrecorte | **Autorrecorte** |
| Deshacer último cambio | **Deshacer** |
| Rehacer cambio deshecho | **Rehacer** |
| Restaurar segmento individual | **Restaurar** |
| Iniciar export | **Exportar** |

### Interruptores de autorrecorte (desplegable del botón dividido)
| Interruptor | Copy exacto |
|-------------|-------------|
| Eliminar silencios | **Silencios** |
| Eliminar muletillas | **Muletillas** |
| Eliminar retakes | **Repeticiones** |

### Nombres de estilos predefinidos (tarjetas del selector)
| Estilo | Copy exacto |
|--------|-------------|
| Estilo chispa | **Chispa** |
| Estilo revista | **Revista** |
| Estilo titular | **Titular** |
| Estilo claro | **Claro** |
| Estilo foco | **Foco** |

### Títulos de sección
| Sección | Copy exacto |
|---------|-------------|
| Zona de subida (estado vacío) | *(sin título — el botón y la zona drag-and-drop son suficientes)* |
| Panel de autorrecorte | **Autorrecorte** |
| Selector de estilos | **Estilo** |
| Línea de tiempo | **Línea de tiempo** |
| Vista de transcripción | **Transcripción** |

### Aviso de autorrecorte
| Situación | Copy exacto |
|-----------|-------------|
| Autorrecorte aplicado | **Autorrecorte listo** *(toast de 5 segundos, se cierra al tocarlo)* |

Sin resumen con desglose. La palabra «retakes» no aparece en la UI.

### Opción de estilo
| Check | Copy exacto |
|-------|-------------|
| Activar contorno del estilo | **Contorno** |

### Línea de tiempo en móvil
| Acción | Copy exacto |
|--------|-------------|
| Ocultar la línea de tiempo | **Plegar** |
| Mostrar la línea de tiempo | **Desplegar** |

### Mensajes de error (cerrados)
| Situación | Mensaje exacto al usuario |
|-----------|--------------------------|
| Archivo no válido o mayor de 500 MB | **El archivo no es válido. Sube un video de menos de 500 MB.** |
| Fallo al transcribir | **No se pudo transcribir el video. Intenta de nuevo.** |
| Fallo al exportar | **No se pudo exportar. Intenta de nuevo.** |
| Demasiadas solicitudes | **Demasiadas solicitudes. Espera un momento.** |

### Auditoría de capas de texto por sección

| Sección | Capas permitidas | Capas usadas | Estado |
|---------|-----------------|--------------|--------|
| Zona de subida | Componente (drag-and-drop) + botón | 2 | ✅ |
| Panel de autorrecorte | Título + botón dividido (+ desplegable con 3 interruptores y toast temporal) | 2 | ✅ |
| Selector de estilos | Título + barra de pasos + 5 tarjetas de estilo + check Contorno + Back/Next (la preview es el reproductor) | 9 | ✅ |
| Línea de tiempo | Título + componente (+ botón Plegar/Desplegar en móvil) | 3 | ✅ |
| Transcripción | Título + segmentos con tiempos | 2 | ✅ |
| Mensajes de error | Un solo mensaje por error | 1 | ✅ |

Ninguna sección supera el presupuesto de capas.

---

## Checklist de CLAUDE.md Sección 6 que aplica a esta fase

| Item | Cómo aplica en Fase 1 |
|------|-----------------------|
| ✅ No hay secretos en código, logs ni repo | `GROQ_API_KEY` solo en `.env.local`, en `.gitignore` |
| ✅ Llave de Groq solo en variables de entorno del servidor | Leída únicamente en `app/api/transcribe/route.ts`, nunca enviada al cliente |
| ✅ Validación de inputs en el backend | Tipo MIME, tamaño máximo 500 MB — validados en `app/api/upload/route.ts` |
| ✅ Rate limiting en subida, transcripción y export | Implementado en los tres endpoints desde el inicio |
| ✅ Todos los estados de UI cubiertos | Vacío · Cargando (subida) · Cargando (transcripción) · Cargando (export) · Éxito · Error |
| ✅ Errores del servidor no exponen info interna | El frontend recibe solo los mensajes del copy cerrado |

---

## Estructura de carpetas prevista (solo Fase 1)

```
ai-editor-2/
├── app/
│   ├── page.tsx                        # Pantalla principal (única ruta en Fase 1)
│   └── api/
│       ├── upload/route.ts             # Recibe y guarda videos e imágenes (máx. 500 MB por video)
│       ├── transcribe/route.ts         # Llama a Groq, devuelve transcripción
│       ├── export/route.ts             # Ejecuta ffmpeg nativo, devuelve video cortado
│       ├── files/[id]/route.ts         # Sirve los archivos de uploads/ para preview
│       └── project/route.ts            # Guarda/carga el estado del proyecto en JSON local
├── components/
│   ├── VideoUploader.tsx               # Drag-and-drop múltiple + estados de carga
│   ├── TranscriptionView.tsx           # Frases de 3–5 palabras con tiempos
│   ├── AutocutPanel.tsx                # Checks + botón Autorrecorte (aviso: toast)
│   ├── Timeline.tsx                    # Línea de tiempo con pistas video + texto + imagen
│   ├── PreviewPlayer.tsx               # Reproductor con el aspecto del video, overlay de estilo e imágenes
│   ├── StylePicker.tsx                 # Tarjetas de estilo sobre el fotograma real, Back/Next
│   └── ExportButton.tsx                # Botón Exportar con estados
├── lib/
│   ├── groq.ts                         # Cliente Groq (solo servidor)
│   ├── ffmpeg.ts                       # ffmpeg/ffprobe nativos (solo servidor)
│   ├── autocut.ts                      # Lógica de autorrecorte (solo cliente, sin servidor)
│   ├── phrases.ts                      # Agrupación en frases de 3–5 palabras (solo cliente)
│   ├── assBuilder.ts                   # Genera el .ASS por estilo (solo servidor)
│   ├── rateLimit.ts                    # Rate limiting por IP
│   └── styles/                         # Parámetros cerrados de cada estilo predefinido
│       └── presets.ts
├── types/
│   └── project.ts                      # Tipos: Layer, StylePresetId, ProjectState, etc.
├── uploads/                            # Videos, imágenes y JSON de estado — en .gitignore
├── .env.example                        # Solo GROQ_API_KEY, sin valor
├── .env.local                          # Variables de entorno — en .gitignore
├── .gitignore
├── CLAUDE.md
└── PLAN.md
```

---

## Criterio de "Fase 1 completada"

- [ ] Se pueden subir varios videos desde la UI sin errores (máx. 500 MB por video, en orden de subida) e imágenes propias
- [ ] El servidor llama a Groq con `verbose_json` y recibe una transcripción real con tiempos por palabra y por segmento
- [ ] La transcripción aparece en pantalla en frases de 3–5 palabras, sincronizadas con el video
- [ ] El autorrecorte aplica directo, avisa con el toast **Autorrecorte listo** y marca los segmentos quitados — y no quita frases buenas
- [ ] Cada segmento quitado se puede restaurar individualmente
- [ ] Deshacer y Rehacer funcionan sobre la lista de cortes
- [ ] El ajuste de bordes de un clip funciona arrastrando el inicio o el fin
- [ ] La línea de tiempo se mueve fluida (60 fps) sin saltos
- [ ] Las imágenes se pueden mover, borrar individualmente, borrar todas y activar/desactivar con toggle
- [ ] Los cinco estilos predefinidos son seleccionables y se ven en preview igual que en el export
- [ ] El export produce un video cortado con ffmpeg nativo local — con estilo e imágenes quemadas, o limpio si no hay estilo
- [ ] La preview coincide con el MP4 final, con el aspecto del video subido (9:16 en reels verticales)
- [ ] Los seis estados de UI funcionan: vacío · cargando ×3 · éxito · error
- [ ] El copy de todos los botones, checks, títulos y mensajes coincide exactamente con las tablas de copy cerrado
- [ ] `GROQ_API_KEY` no aparece en ningún archivo del repo
- [ ] El modelo de datos de `Layer` incluye los tipos `image` y `audio` preparados para Fase 1.5
- [ ] El repo tiene un commit limpio con el trabajo de Fase 1

---

---

## Decisiones resueltas por el usuario

- **Nombre del antiguo check «Quitar repeticiones»:** resuelto con el botón dividido y el interruptor **Repeticiones**.
- **«La sombra prevalece»:** resuelto. Con el check Contorno encendido, el contorno fino se dibuja detrás de la sombra y la sombra sigue prevaleciendo visualmente (ver «Sombra y contorno»).

---

> **Aprobado por el arquitecto — Fase 1 en construcción en `ai-editor-2`.**
