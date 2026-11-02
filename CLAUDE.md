# CLAUDE.md — Guía de contexto para el agente de desarrollo

> Este archivo le dice al agente qué es el proyecto, qué está decidido, qué no se toca, y cómo se trabaja aquí.

---

## Sección 1 — Contexto del producto

**Nombre:** ai-video-editor
**Tipo:** Producto independiente. No es el transcriptor. Es un editor de video impulsado por IA para creadoras de contenido.

**Usuarios actuales (fase de prueba):**
- Fernando (arquitecto) y Mochi — probando internamente
- Sin usuarios de pago todavía

**Usuarios objetivo (producción):**
- Creadoras de contenido que pagan por el servicio

**Presupuesto y restricciones de infraestructura:**
- Groq API en tier gratuito (sin costo por ahora)
- Worker pequeño sin costo fijo (no se paga render por minuto)
- Sin servicios de pago que escalen por uso no controlado en v1

**Nivel de riesgo:** Medio
- Los videos son personales de las creadoras
- No es dominio de salud, no hay menores de edad
- Requiere privacidad estricta: **nunca exponer archivos de una creadora a otra**

**Horizonte:** Proyecto con intención de crecimiento. Las decisiones de arquitectura deben permitir escalar.

**Datos sensibles:**
- Videos personales de creadoras
- La privacidad es prioritaria
- El aislamiento de archivos entre usuarias es una regla no negociable

---

## Sección 2 — Stack tecnológico

**Frontend:**
- Next.js con React

**Backend / procesamiento de video:**
- Node.js
- ffmpeg y ffprobe para manipulación de video

**Transcripción:**
- Groq Whisper — modelo: `whisper-large-v3-turbo`

**Subtítulos:**
- ASS con libass (renderizado en ffmpeg)

**Despliegue por fases:**
- Fases 1, 1.5 y siguientes hasta antes del deploy: local (desarrollo y prueba)
- La última fase (deploy): Vercel para la web + worker separado con ffmpeg y cola de trabajos
- **El worker se lanza solo cuando el producto funcione perfecto en local, no antes**

**Stack objetivo a $0 a bajo volumen:**
- Web: Vercel (tier gratuito)
- Worker: Oracle Always Free con cola
- Transcripción: Groq (tier gratuito)
- GitHub Edu solo como arranque — no como base permanente de la arquitectura

**Lo que NO se usa en v1 (decisiones negativas explícitas):**
- ❌ ElevenLabs — no es base del stack
- ❌ Remotion — no en v1
- ❌ Animaciones generadas por Claude — no se usan
- ❌ Segmentación de persona ni chroma key — no en v1

---

## Sección 3 — Decisiones ya tomadas

Estas decisiones están cerradas. El agente no las cuestiona, no sugiere alternativas, no las debate. Si hay un problema técnico con alguna de ellas, se reporta el problema concreto y se espera instrucción del arquitecto.

### Roadmap v1 — orden fijo

| Fase | Qué hace |
|------|----------|
| **Fase 1** | Subir varios videos e imágenes propias, transcribir con Groq Whisper, autorrecorte, línea de tiempo fluida, deshacer/rehacer, restauración de segmentos, imágenes de apoyo, estilos predefinidos y export con ffmpeg local. |
| **Fase 1.5** | Banco de imágenes propio (sin licencia, con favoritos) y biblioteca de sonidos cortos por evento — sobre el terreno preparado en Fase 1. |
| **Fase 2** | Texto personalizable nivel Premiere. Sistema Looks completo: guardar, duplicar, editar y poner por defecto. |
| **Fase 3** | Capas avanzadas, filtros preset y preview fiel refinado. |
| **Fase 4 (deploy)** | Deploy en Vercel + worker separado con ffmpeg y cola. |

### Modos de edición
- **Modo Basic:** 5 clics, flujo guiado
- **Modo Pro:** interfaz tipo CapCut, control total
- Ambos modos usan **el mismo motor** de procesamiento. No hay dos implementaciones.

### Regla de contraste (texto sobre video)
Actualizada por decisión del usuario (Fase 1). Reemplaza la regla anterior «ningún texto sin sombra, contorno o caja».
- **Sombra activa por defecto** en Chispa, Revista, Titular y en las palabras de énfasis. **Sin sombra por defecto** en Claro y Foco (subtitulado simple).
- **Contorno apagado por defecto**, con un check **Contorno** por estilo. Si sombra y contorno están activos, la sombra prevalece (interpretación pendiente, ver abajo).
- **No se fuerza contorno solo por contraste.** El contraste se verifica contra el fotograma real, no contra un fondo asumido, y el editor **avisa** antes de exportar cuando un texto no se lee.
- **Amarillo plano sin sombra sobre fondo claro** siempre se marca como fallo de contraste.
- Si una imagen de apoyo choca con el texto, la imagen va detrás y el texto encima con sombra.

### Decisiones del usuario aplicadas en Fase 1
- **Autorrecorte:** al aplicarlo se avisa con un popup tipo toast de 5 segundos, cerrable al tocarlo, con el texto **Autorrecorte listo**. No hay resumen con desglose en la UI. Lo quitado queda marcado en la línea de tiempo y en la transcripción.
- **Aspecto del video:** el reproductor y el export respetan el aspecto del video subido, sin distorsión ni recorte forzado a 9:16; 9:16 es solo el caso normal de reels verticales. Un video de móvil con rotación de 90° sale vertical, no horizontal. Si se mezclan aspectos, el video que no coincide con el lienzo queda encajado con barras, sin deformar.
- **Texto movible:** el bloque de texto de cada estilo se arrastra en la preview. La posición se guarda en %, se puede deshacer y rehacer, y el export la respeta. Si una imagen choca con el texto, la imagen va detrás y el texto encima con sombra.
- **Retake:** solo dentro del mismo video en Fase 1, no entre videos consecutivos.
- **Export:** watchdog de ffmpeg por falta de progreso. Si pasa 60 segundos sin progreso, se mata el proceso, se borra la carpeta del export y se devuelve «No se pudo exportar. Intenta de nuevo.». El tiempo máximo actual se mantiene como techo de seguridad. El preset de calidad no cambia por ahora.

### Pendiente de decisión del usuario
1. **Nombre del check:** hoy **Quitar repeticiones**, en vez de «Quitar retakes».
2. **Interpretación de «la sombra prevalece»:** hoy, donde hay sombra no se dibuja contorno, y eso hace que el check **Contorno** no cambie nada en Chispa, Revista ni Titular. Falta confirmar si es así o si deben verse sombra y contorno a la vez.

---

## Sección 4 — Reglas de la casa

Estas reglas aplican en todo momento, sin excepción.

### Seguridad de secretos
- **Ninguna llave en código fuente, en el frontend, en logs, ni en el repositorio.**
- Todo secreto va en variables de entorno del servidor únicamente.
- La llave de Groq **nunca** llega al navegador. Solo la usa el servidor.
- Si una llave aparece en código, el PR no pasa.

### Ritmo de trabajo
- Los cambios son pequeños y revisables, uno por vez.
- No se mezclan fases ni se anticipa trabajo de una fase siguiente.
- **Commit y push después de cada fase que pase** (tests + revisión del arquitecto).

### Copy y lenguaje de la UI
- **Misma palabra para la misma acción en toda la pantalla.** Sin alternar sinónimos.
- Los textos de botones, checks, títulos y mensajes siguen el copy cerrado de PLAN.md de cada fase.
- Si el icono o el componente ya explica la acción, sin descripción adicional.
- Sin pila redundante: máximo título + descripción corta si es necesaria + componente.

### Autenticación y aislamiento (pendiente para fase de deploy)
- En Fases 1, 1.5 y siguientes hasta antes del deploy no hay autenticación de usuarias — se asume un solo entorno local.
- El aislamiento completo entre usuarias se implementa en la fase de deploy (Fase 4), no antes.
- Esta decisión es intencional y está registrada aquí, **no es un olvido**.
- Cuando llegue el deploy, ningún archivo de una creadora puede ser accesible por otra.

### Isolación de datos
- Los archivos de una creadora nunca son accesibles por otra.
- Esta regla se implementa desde el diseño de rutas y almacenamiento, no como parche posterior.

---

## Sección 5 — Cómo trabajar con este agente

> Sección universal — no modificar por proyecto.

- El agente actúa como **desarrollador full-stack senior**.
- El arquitecto toma las decisiones de producto y arquitectura. El agente las implementa.
- Si algo no está claro, el agente **pregunta antes de asumir**.
- Si algo está en conflicto con una regla de esta guía, el agente **detiene y reporta** en lugar de resolver por su cuenta.
- El agente no sobre-ingenia. Si hay una solución simple que cumple el requisito, esa es la correcta.
- El agente no agrega dependencias sin aprobación explícita.
- El agente no cambia el stack, el modelo de IA, ni las herramientas sin instrucción del arquitecto.

---

## Sección 6 — Checklist universal antes de cualquier PR

> Sección universal — no modificar por proyecto.

- [ ] No hay secretos en el código, logs ni repo
- [ ] La llave de Groq (u otro proveedor) solo existe en variables de entorno del servidor
- [ ] Validación de inputs en el backend (tipo, tamaño, formato)
- [ ] Rate limiting activo en endpoints de subida, transcripción y export
- [ ] Todos los estados de UI están cubiertos: vacío, cargando, éxito, error
- [ ] Los errores del servidor no exponen información interna al frontend
- [ ] No hay archivos de una usuaria accesibles por otra
- [ ] El código es pequeño, revisable y tiene un solo propósito por PR
- [ ] Tests pasando (cuando aplique)
- [ ] Commit limpio con mensaje descriptivo

---

## Sección 7 — Glosario mínimo

> Sección universal — no modificar por proyecto.

| Término | Significado en este proyecto |
|---------|------------------------------|
| **Arquitecto** | Fernando — toma decisiones de producto y arquitectura |
| **Agente** | Claude / Antigravity — implementa, no decide |
| **Creadora** | Usuaria final que paga por el servicio |
| **Worker** | Proceso separado que corre ffmpeg fuera del servidor web |
| **ASS** | Advanced SubStation Alpha — formato de subtítulos con estilos ricos |
| **libass** | Biblioteca que renderiza archivos ASS dentro de ffmpeg |
| **Modo Basic** | Flujo de 5 clics, sin configuración avanzada |
| **Modo Pro** | Interfaz completa tipo CapCut, control total |
| **Fase** | Unidad de trabajo del roadmap v1, se completa antes de pasar a la siguiente |

