// Pruebas de lógica de Fase 1. Se corren con `npm test` (ver scripts/test-logic.cjs),
// que compila lib/ a una carpeta temporal y pasa su ruta como primer argumento.
// Datos: transcripciones de prueba en testmedia/ (tr1.json, tr2.json, export-body.json).

const assert = require('assert')
const { mkdtempSync, writeFileSync, copyFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const B = process.argv[2] // lib/ compilado
const R = process.argv[3] // raíz del repo
if (!B || !R) {
  console.error('Uso: npm test')
  process.exit(1)
}

const { buildPhrases } = require(`${B}/phrases.js`)
const { buildCutSegments, totalDuration } = require(`${B}/timeline.js`)
const { buildCues, activeCue } = require(`${B}/cues.js`)
const { applyAutocut } = require(`${B}/autocut.js`)
const { failsContrast } = require(`${B}/contrast.js`)
const { STYLE_PRESETS, resolveStyle } = require(`${B}/styles/presets.js`)
const { buildAss } = require(`${B}/assBuilder.js`)
const { probeImage, probeVideo, runFfmpeg, FfmpegTimeoutError, exportTimeoutMs } = require(`${B}/ffmpeg.js`)
const { canvasFor, DEFAULT_CANVAS } = require(`${B}/canvas.js`)
const { textRect, cueHitsImage, clampOffset } = require(`${B}/textLayout.js`)

const tr1 = require(`${R}/testmedia/tr1.json`).transcription
const tr2 = require(`${R}/testmedia/tr2.json`).transcription
const body = require(`${R}/testmedia/export-body.json`)

// Duraciones reales de los videos de prueba (pista de video, ffprobe).
// tr1 trae la palabra "terminaremos." hasta 14.48 s en un video de 14.0 s.
const V1_DUR = 14.0
const V2_DUR = 2.166667
const FPS = 30

// Las pruebas se registran y se corren en orden al final (admiten async).
const tests = []
function test(name, fn) {
  tests.push({ name, fn })
}

const p1 = buildPhrases('v1', tr1, V1_DUR)
const p2 = buildPhrases('v2', tr2, V2_DUR)
const vids = [
  { id: 'v1', duration: V1_DUR, fps: FPS },
  { id: 'v2', duration: V2_DUR, fps: FPS },
]
const { phrases: cut, summary } = applyAutocut([...p1, ...p2], {
  silences: true,
  fillers: true,
  retakes: true,
})
const segs = buildCutSegments(vids, cut)

// ---- Frases ----
test('frases: nunca más de 5 palabras y nunca a mitad de palabra', () => {
  const words = tr1.words.map((w) => w.word)
  for (const u of [...p1, ...p2]) {
    if (u.kind !== 'phrase') continue
    assert(u.words.length >= 1 && u.words.length <= 5, `${u.words.length} palabras: "${u.text}"`)
    for (const w of u.words) assert(typeof w.word === 'string' && w.word.trim(), 'palabra vacía')
  }
  assert(p1.filter((u) => u.kind === 'phrase').flatMap((u) => u.words.map((w) => w.word)).join(' ') === words.join(' '))
})

test('frases: particionan el video sin huecos y no pasan de la duración real', () => {
  for (const [ps, d] of [[p1, V1_DUR], [p2, V2_DUR]]) {
    assert.strictEqual(ps[0].start, 0)
    for (let i = 1; i < ps.length; i++) {
      assert(Math.abs(ps[i].start - ps[i - 1].end) < 1e-9, `hueco en ${ps[i].id}`)
    }
    const end = ps[ps.length - 1].end
    assert(end <= d + 1e-9, `termina en ${end}, el video dura ${d}`)
  }
})

test('autorrecorte: marca lo quitado sin tocar el original y lo deja fuera de los segmentos', () => {
  const removed = cut.filter((u) => u.removed)
  assert(removed.length > 0, 'debía quitar algo')
  for (const u of removed) assert(['silence', 'filler', 'retake'].includes(u.reason), `motivo ${u.reason}`)
  assert(removed.some((u) => u.reason === 'silence') && removed.some((u) => u.reason === 'filler') && removed.some((u) => u.reason === 'retake'))
  // las unidades quitadas siguen en la lista (para marcarlas en línea de tiempo y transcripción)
  assert.strictEqual(cut.length, p1.length + p2.length)
  assert(p1.every((u) => !u.removed), 'el original no se modifica')
  const kept = new Set(segs.map((s) => s.unitId))
  for (const u of removed) assert(!kept.has(u.id), `${u.id} quitado pero sigue en segmentos`)
  assert(summary.seconds > 0)
})

// ---- Segmentos ----
test('segmentos: bordes alineados a fotograma y dentro del video', () => {
  assert(segs.length > 0)
  for (const s of segs) {
    for (const x of [s.srcStart, s.srcEnd]) {
      assert(Math.abs(x * FPS - Math.round(x * FPS)) < 1e-6, `${x} no cae en un fotograma`)
    }
    const max = s.videoId === 'v1' ? V1_DUR : V2_DUR
    assert(s.srcEnd <= max + 1e-9, `${s.unitId} termina en ${s.srcEnd} > ${max}`)
    assert(s.srcEnd > s.srcStart)
  }
})

test('segmentos: la duración de la línea de tiempo = suma exacta de fotogramas', () => {
  const frames = segs.reduce((a, s) => a + Math.round((s.srcEnd - s.srcStart) * FPS), 0)
  assert(Math.abs(totalDuration(segs) - frames / FPS) < 1e-9)
  for (let i = 1; i < segs.length; i++) {
    assert(Math.abs(segs[i].tlStart - segs[i - 1].tlEnd) < 1e-9, 'línea de tiempo no contigua')
  }
})

test('segmentos: el caso del pendiente de Zai da 9.400 s (282 fotogramas), no 9.87 ni 9.47', () => {
  const ids = body.videos.map((v) => v.id)
  const old = buildCutSegments(
    [
      { id: ids[0], duration: V1_DUR, fps: FPS },
      { id: ids[1], duration: V2_DUR, fps: FPS },
    ],
    body.phrases
  )
  assert(Math.abs(totalDuration(old) - 9.4) < 1e-9, `duración ${totalDuration(old)}`)
})

test('cues: sin solapes, con duración y activeCue semiabierto como libass', () => {
  for (const id of Object.keys(STYLE_PRESETS)) {
    const cues = buildCues(id, cut, segs)
    assert(cues.length > 0, id)
    for (const c of cues) assert(c.end > c.start, `${id}: cue vacío`)
    for (let i = 1; i < cues.length; i++) {
      assert(cues[i].start >= cues[i - 1].end - 1e-9, `${id}: solape`)
      if (Math.abs(cues[i].start - cues[i - 1].end) < 1e-9) {
        assert.strictEqual(activeCue(cues, cues[i].start).id, cues[i].id, `${id}: frontera`)
      }
    }
  }
})

// ---- Sombra, contorno y contraste ----
test('sombra y contorno: sombra por defecto en títulos y énfasis, contorno apagado, la sombra prevalece', () => {
  const shadowed = ['chispa', 'revista', 'titular']
  const simple = ['claro', 'foco']
  for (const id of Object.keys(STYLE_PRESETS)) {
    const p = resolveStyle(STYLE_PRESETS[id])
    assert.strictEqual(p.base.outlineWidth, 0, `${id}: contorno debe estar apagado por defecto`)
    if (shadowed.includes(id)) assert(p.base.shadowOffset > 0, `${id}: sombra por defecto`)
    if (simple.includes(id)) assert.strictEqual(p.base.shadowOffset, 0, `${id}: subtitulado simple sin sombra`)
    if (p.emphasis) assert(p.emphasis.shadowOffset > 0, `${id}: énfasis con sombra`)
    const withOutline = resolveStyle(STYLE_PRESETS[id], { outline: true })
    if (shadowed.includes(id)) assert.strictEqual(withOutline.base.outlineWidth, 0, `${id}: la sombra prevalece`)
    if (simple.includes(id)) assert(withOutline.base.outlineWidth > 0, `${id}: contorno activable`)
  }
})

test('contraste: avisa contra el fondo real cuando el texto no tiene borde y no se lee', () => {
  const claro = resolveStyle(STYLE_PRESETS.claro)
  assert.strictEqual(failsContrast(claro, 0.95), true, 'Claro sin sombra ni contorno sobre fondo claro: avisar')
  assert.strictEqual(failsContrast(claro, 0.02), false, 'Claro sobre fondo oscuro: se lee')
  assert.strictEqual(failsContrast(resolveStyle(STYLE_PRESETS.claro, { outline: true }), 0.95), false, 'con contorno se lee')
  for (const id of ['chispa', 'revista', 'titular']) {
    for (const lum of [1, 0.9, 0.3, 0]) assert.strictEqual(failsContrast(resolveStyle(STYLE_PRESETS[id]), lum), false, `${id} ${lum}`)
  }
  const flatYellow = { ...claro, base: { ...claro.base, color: '#FFD84D' }, emphasis: null }
  assert.strictEqual(failsContrast(flatYellow, 0.9), true, 'amarillo plano sin sombra sobre fondo claro: avisar')
})

// ---- Archivo ASS ----
test('ASS: sombra/contorno según el estilo, banda visible, WrapStyle 1 y tiempos hacia abajo', () => {
  const total = totalDuration(segs)
  const field = (ass, name) => ass.split('\n').find((l) => l.startsWith(`Style: ${name},`)).split(',')
  // columnas del estilo: 5 OutlineColour, 16 Outline, 17 Shadow
  const foco = buildAss('foco', buildCues('foco', cut, segs), total)
  assert.deepStrictEqual(field(foco, 'Main').slice(16, 18), ['0', '0'], 'Foco por defecto sin contorno ni sombra')
  const fm = field(buildAss('foco', buildCues('foco', cut, segs), total, undefined, { outline: true }), 'Main')
  assert.strictEqual(fm[16], '2.5')
  assert.strictEqual(fm[5], '&H19100C0C', 'contorno #0C0C10 al 90%')
  const chispa = buildAss('chispa', buildCues('chispa', cut, segs), total, undefined, { outline: true })
  assert.deepStrictEqual(field(chispa, 'Main').slice(16, 18), ['0', '5'], 'Chispa: la sombra prevalece sobre el contorno')
  const claroOutline = buildAss('claro', buildCues('claro', cut, segs), total, undefined, { outline: true })
  assert(/\\shad3\\4c&H000000&\\4a&H66&\\bord0/.test(claroOutline), 'énfasis con sombra y sin contorno')
  assert(foco.includes('WrapStyle: 1'))
  const rev = buildAss('revista', buildCues('revista', cut, segs), total)
  assert(/^Style: Band,Arial,64,&HDBFFFFFF,/.test(field(rev, 'Band').join(',')))
  const dialogue = buildAss('claro', buildCues('claro', cut, segs), total).split('\n').filter((l) => l.startsWith('Dialogue:'))
  assert(dialogue.length > 0)
  for (const d of dialogue) assert(/^Dialogue: \d,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,/.test(d), d)
  assert(dialogue.some((d) => d.includes(',0:00:02.26,')), 'frontera a 68 fotogramas debe ser 0:00:02.26')
})

// ---- Texto movible e imágenes ----
test('texto movible: el ASS respeta el desplazamiento guardado en %', () => {
  const total = totalDuration(segs)
  const cues = buildCues('claro', cut, segs)
  const pos = (ass) => ass.split('\n').find((l) => l.startsWith('Dialogue:')).match(/\\pos\((\d+),(\d+)\)/).slice(1).map(Number)
  assert.deepStrictEqual(pos(buildAss('claro', cues, total)), [540, Math.round(0.595 * 1920)])
  assert.deepStrictEqual(pos(buildAss('claro', cues, total, undefined, { offset: { x: 10, y: -20 } })), [Math.round(0.6 * 1080), Math.round(0.395 * 1920)])
  const rev = buildAss('revista', buildCues('revista', cut, segs), total, undefined, { offset: { x: 5, y: 10 } })
  assert(rev.includes(`\\an4\\pos(${Math.round(0.13 * 1080)},${Math.round(0.6 * 1920)})`), 'Revista bloque izquierdo movido')
  assert.deepStrictEqual(clampOffset({ x: 99, y: -99 }), { x: 50, y: -50 })
  assert.deepStrictEqual(clampOffset({ x: 'a' }), { x: 0, y: 0 })
})

test('imagen detrás del texto: si choca, el texto lleva sombra; si no, queda igual', () => {
  const total = totalDuration(segs)
  const cues = buildCues('foco', cut, segs)
  const foco = resolveStyle(STYLE_PRESETS.foco)
  const rect = textRect(foco, 'left', { x: 0, y: 0 }, DEFAULT_CANVAS)
  const under = { id: 'i', type: 'image', start: 0, end: total, order: 10, x: 50, y: 78, width: 40, height: 21, enabled: true }
  const away = { ...under, y: 15 }
  assert.strictEqual(cueHitsImage(cues[0], rect, [under]), true, 'la imagen por defecto choca con Foco')
  assert.strictEqual(cueHitsImage(cues[0], rect, [away]), false)
  assert.strictEqual(cueHitsImage(cues[0], rect, [{ ...under, enabled: false }]), false, 'imagen apagada no cuenta')
  const hit = buildAss('foco', cues, total, undefined, { imageLayers: [under] })
  const free = buildAss('foco', cues, total, undefined, { imageLayers: [away] })
  assert(hit.split('\n').filter((l) => l.startsWith('Dialogue:')).every((l) => l.includes(',MainS,')), 'con imagen debajo usa el estilo con sombra')
  assert(free.split('\n').filter((l) => l.startsWith('Dialogue:')).every((l) => l.includes(',Main,')))
  const mainS = hit.split('\n').find((l) => l.startsWith('Style: MainS,')).split(',')
  assert.deepStrictEqual(mainS.slice(16, 18), ['0', '3'], 'sombra de choque, sin contorno')
})

// ---- Aspecto del video ----
test('lienzo: respeta el aspecto del video, lado corto 1080 y medidas pares', () => {
  assert.deepStrictEqual(canvasFor(720, 1280), { w: 1080, h: 1920 }) // 9:16
  assert.deepStrictEqual(canvasFor(1920, 1080), { w: 1920, h: 1080 }) // 16:9
  assert.deepStrictEqual(canvasFor(1080, 1080), { w: 1080, h: 1080 }) // 1:1
  assert.deepStrictEqual(canvasFor(1080, 1350), { w: 1080, h: 1350 }) // 4:5
  const odd = canvasFor(853, 480)
  assert(odd.w % 2 === 0 && odd.h === 1080 && Math.abs(odd.w / odd.h - 853 / 480) < 0.01, JSON.stringify(odd))
  assert.deepStrictEqual(canvasFor(0, 0), DEFAULT_CANVAS)
  const ass = buildAss('claro', [], 1, { w: 1920, h: 1080 })
  assert(ass.includes('PlayResX: 1920') && ass.includes('PlayResY: 1080'))
})

test('lienzo: un video de móvil rotado 90° se lee vertical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-editor-rot-'))
  try {
    const land = join(dir, 'land.mp4')
    const rot = join(dir, 'rot.mp4')
    await runFfmpeg(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.5', '-pix_fmt', 'yuv420p', land])
    await runFfmpeg(['-v', 'error', '-y', '-display_rotation', '90', '-i', land, '-c', 'copy', rot])
    const a = await probeVideo(land)
    const b = await probeVideo(rot)
    assert.deepStrictEqual([a.width, a.height], [320, 180])
    assert.deepStrictEqual([b.width, b.height], [180, 320], 'rotado debe leerse 180x320')
    assert.deepStrictEqual(canvasFor(b.width, b.height), { w: 1080, h: 1920 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- Imágenes de apoyo y tiempo máximo de ffmpeg (usan ffmpeg/ffprobe del sistema) ----
test('imagen corrupta: probeImage la rechaza rápido y acepta la válida', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-editor-img-'))
  try {
    const ok = join(dir, 'ok.png')
    copyFileSync(`${R}/testmedia/imagen.png`, ok)
    const valid = await probeImage(ok)
    assert.strictEqual(valid, true, 'testmedia/imagen.png debe pasar')

    const png = require('fs').readFileSync(ok)
    const corrupt = {
      'aleatoria.png': Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 97 + 13) % 256)),
      'truncada.png': png.subarray(0, 800),
      'solo-cabecera.png': png.subarray(0, 8),
      'vacia.png': Buffer.alloc(0),
    }
    for (const [name, bytes] of Object.entries(corrupt)) {
      const p = join(dir, name)
      writeFileSync(p, bytes)
      const t0 = Date.now()
      const result = await probeImage(p)
      const ms = Date.now() - t0
      assert.strictEqual(result, false, `${name} debe rechazarse`)
      assert(ms < 5000, `${name} tardó ${ms} ms`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tiempo máximo: runFfmpeg mata ffmpeg y rechaza con FfmpegTimeoutError', async () => {
  assert(exportTimeoutMs(0) >= 60_000, 'mínimo razonable')
  assert(exportTimeoutMs(600) > exportTimeoutMs(10), 'crece con la duración')
  const t0 = Date.now()
  // entrada infinita: sin tiempo máximo nunca terminaría
  const err = await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=r=5', '-f', 'null', '-'], undefined, 1500)
    .then(() => null)
    .catch((e) => e)
  const ms = Date.now() - t0
  assert(err instanceof FfmpegTimeoutError, `debía ser FfmpegTimeoutError: ${err}`)
  assert(ms < 6000, `tardó ${ms} ms en detenerse`)
})

;(async () => {
  let passed = 0
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      passed++
      console.log(`ok   - ${name}`)
    } catch (err) {
      failed++
      console.log(`FAIL - ${name}\n       ${err.message}`)
    }
  }
  console.log(`\n${passed} pasan, ${failed} fallan`)
  process.exit(failed ? 1 : 0)
})()
