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
const { buildCues, activeCue, cueLines } = require(`${B}/cues.js`)
const { applyAutocut } = require(`${B}/autocut.js`)
const { failsContrast } = require(`${B}/contrast.js`)
const { STYLE_PRESETS, resolveStyle, outlineLayers, DIFFUSE_SHADOW, shadowXY, shadowBlurCss, shadowBlurAss } = require(`${B}/styles/presets.js`)
const { buildAss } = require(`${B}/assBuilder.js`)
const { probeImage, probeVideo, runFfmpeg, FfmpegTimeoutError, FfmpegStallError, EXPORT_STALL_MS, exportTimeoutMs } = require(`${B}/ffmpeg.js`)
const { canvasFor, DEFAULT_CANVAS } = require(`${B}/canvas.js`)
const { textRect, cueHitsImage, clampOffset, safeOffset, SAFE_MARGIN } = require(`${B}/textLayout.js`)

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
test('sombra y contorno: sombra por defecto en títulos y énfasis, contorno apagado y activable en los 5', () => {
  const shadowed = ['chispa', 'revista', 'titular']
  const simple = ['claro', 'foco']
  for (const id of Object.keys(STYLE_PRESETS)) {
    const p = resolveStyle(STYLE_PRESETS[id])
    assert.strictEqual(p.base.outlineWidth, 0, `${id}: contorno debe estar apagado por defecto`)
    if (shadowed.includes(id)) assert(p.base.shadowOffset > 0, `${id}: sombra por defecto`)
    if (simple.includes(id)) assert.strictEqual(p.base.shadowOffset, 0, `${id}: subtitulado simple sin sombra`)
    if (p.emphasis) assert(p.emphasis.shadowOffset > 0, `${id}: énfasis con sombra`)
    assert.strictEqual(outlineLayers(p), null, `${id}: sin contorno, una sola capa`)
    // con el check encendido hay contorno en los 5 estilos, también con sombra
    const withOutline = resolveStyle(STYLE_PRESETS[id], { outline: true })
    assert(withOutline.base.outlineWidth > 0, `${id}: contorno activable`)
    assert(withOutline.base.outlineWidth <= 2.5, `${id}: contorno fino`)
    assert.strictEqual(withOutline.base.shadowOffset, p.base.shadowOffset, `${id}: la sombra se mantiene`)
    // dos capas: contorno sin sombras abajo, sombras sin contorno arriba
    const { under, over } = outlineLayers(withOutline)
    assert(under.base.outlineWidth > 0 && under.base.shadowOffset === 0, `${id}: capa de abajo solo contorno`)
    assert(!under.emphasis || under.emphasis.shadowOffset === 0, `${id}: énfasis sin sombra abajo`)
    assert.strictEqual(over.base.outlineWidth, 0, `${id}: capa de arriba sin contorno`)
    assert.strictEqual(over.base.shadowOffset, p.base.shadowOffset, `${id}: capa de arriba con la sombra`)
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
test('ASS: capas contorno → sombra difusa → relleno, banda visible, WrapStyle 1 y tiempos hacia abajo', () => {
  const total = totalDuration(segs)
  const lines = (ass) => ass.split('\n')
  const field = (ass, name) => lines(ass).find((l) => l.startsWith(`Style: ${name},`)).split(',')
  const dlg = (ass) => lines(ass).filter((l) => l.startsWith('Dialogue:'))
  // columnas del estilo: 3 PrimaryColour, 5 OutlineColour, 6 BackColour, 16 Outline, 17 Shadow
  const foco = buildAss('foco', buildCues('foco', cut, segs), total)
  assert.deepStrictEqual(field(foco, 'Main').slice(16, 18), ['0', '0'], 'relleno nítido: sin contorno ni sombra')
  assert(!foco.includes('Style: MainU,'), 'sin contorno no hay capa de contorno')
  const fm = field(buildAss('foco', buildCues('foco', cut, segs), total, undefined, { outline: true }), 'MainU')
  assert.strictEqual(fm[16], '2.5')
  assert.strictEqual(fm[5], '&H19100C0C', 'contorno #0C0C10 al 90%')
  // Chispa con contorno: contorno (0) → sombra difusa (1) → relleno (2)
  const chispa = buildAss('chispa', buildCues('chispa', cut, segs), total, undefined, { outline: true })
  assert.deepStrictEqual(field(chispa, 'MainU').slice(16, 18), ['2', '0'], 'capa de contorno fino sin sombra')
  const sh = field(chispa, 'MainSh')
  assert.deepStrictEqual(sh.slice(16, 18), ['0', '2'], 'capa de sombra: sin contorno, 2 px por eje')
  assert.strictEqual(sh[3].slice(0, 4), '&HFE', 'capa de sombra con relleno casi transparente')
  const d = dlg(chispa)
  const u = d.filter((l) => l.includes(',MainU,')), w = d.filter((l) => l.includes(',MainSh,')), f = d.filter((l) => l.includes(',Main,'))
  assert(u.length > 0 && u.length === w.length && w.length === f.length, 'cada frase en las tres capas')
  assert(u.every((l) => l.startsWith('Dialogue: 0,')) && w.every((l) => l.startsWith('Dialogue: 1,')) && f.every((l) => l.startsWith('Dialogue: 2,')), 'contorno detrás de la sombra, relleno arriba')
  assert(w.every((l) => /\\blur\d/.test(l)), 'la sombra es difusa (\\blur)')
  assert(f.every((l) => !/\\blur/.test(l)), 'el relleno no se desenfoca')
  const rv = lines(buildAss('revista', buildCues('revista', cut, segs), total, undefined, { outline: true }))
  assert(rv.some((l) => /^Dialogue: 1,.*,RevLU,/.test(l)) && rv.some((l) => /^Dialogue: 2,.*,RevLSh,/.test(l)) && rv.some((l) => /^Dialogue: 3,.*,RevL,/.test(l)), 'Revista: banda 0, contorno 1, sombra 2, relleno 3')
  // Claro sin sombra base: la capa de sombra solo deja ver las palabras de énfasis
  const claro = buildAss('claro', buildCues('claro', cut, segs), total)
  assert.strictEqual(field(claro, 'MainSh')[6], '&HFF000000', 'palabras base de Claro sin sombra')
  assert(dlg(claro).filter((l) => l.includes(',MainSh,')).every((l) => /\\4a&H73&\\blur/.test(l)), 'énfasis con sombra difusa al 55%')
  assert(foco.includes('WrapStyle: 1'))
  const rev = buildAss('revista', buildCues('revista', cut, segs), total)
  assert(/^Style: Band,Arial,64,&HDBFFFFFF,/.test(field(rev, 'Band').join(',')))
  const dialogue = dlg(buildAss('claro', buildCues('claro', cut, segs), total))
  assert(dialogue.length > 0)
  for (const x of dialogue) assert(/^Dialogue: \d,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,/.test(x), x)
  assert(dialogue.some((x) => x.includes(',0:00:02.26,')), 'frontera a 68 fotogramas debe ser 0:00:02.26')
})

test('sombra difusa: valores del manual VM traducidos (55%, desenfoque 17% del tamaño, -45°)', () => {
  assert.strictEqual(DIFFUSE_SHADOW.alpha, 0.55)
  assert.strictEqual(DIFFUSE_SHADOW.angleDeg, -45)
  const xy = shadowXY(DIFFUSE_SHADOW.distance)
  assert.deepStrictEqual(xy, { x: 2, y: 2 }, 'abajo a la derecha, casi sin desplazamiento')
  assert.strictEqual(shadowBlurCss(88), 15, 'Chispa: 17% de 88 px')
  assert(Math.abs(shadowBlurAss(88) - 10) < 0.01, 'en libass el mismo halo pide /1.5')
  for (const p of Object.values(STYLE_PRESETS)) {
    if (p.base.shadowOffset > 0) {
      assert.strictEqual(p.base.shadowOffset, DIFFUSE_SHADOW.distance, `${p.id}: sombra no desplazada`)
      assert.strictEqual(p.base.shadowAlpha, DIFFUSE_SHADOW.alpha, `${p.id}: 55%`)
    }
    if (p.emphasis) assert.strictEqual(p.emphasis.shadowAlpha, DIFFUSE_SHADOW.alpha, `${p.id}: énfasis al 55%`)
  }
  const ass = buildAss('titular', buildCues('titular', cut, segs), totalDuration(segs))
  const blurs = [...ass.matchAll(/\\blur([\d.]+)/g)].map((m) => +m[1])
  assert(blurs.length > 0 && blurs.every((b) => b > 0), 'el ASS lleva desenfoque en la sombra')
  assert(blurs.some((b) => Math.abs(b - shadowBlurAss(64 * 1.5)) < 0.01), 'la palabra de énfasis usa el desenfoque de su tamaño')
})

// ---- Regla 2: palabra resaltada sola en su línea ----
test('palabra resaltada sola en su línea: cueLines, ASS (\\N) en los 5 estilos y en medio de la frase', () => {
  const W = (t, emph = false) => ({ text: t, emph })
  const show = (lines) => lines.map((l) => l.map((w) => (w.emph ? `[${w.text}]` : w.text)).join(' '))
  assert.deepStrictEqual(show(cueLines([W('aprender', true), W('tres'), W('trucos')])), ['[aprender]', 'tres trucos'])
  assert.deepStrictEqual(show(cueLines([W('tres'), W('trucos'), W('aprender', true), W('nuevos')])), ['tres trucos', '[aprender]', 'nuevos'])
  assert.deepStrictEqual(show(cueLines([W('solo'), W('3', true), W('pasos'), W('y'), W('listo')])), ['solo', '[3]', 'pasos y listo'])
  assert.deepStrictEqual(show(cueLines([W('sin'), W('énfasis')])), ['sin énfasis'], 'sin resaltada no hay corte')
  const total = totalDuration(segs)
  for (const id of Object.keys(STYLE_PRESETS)) {
    const cues = buildCues(id, cut, segs)
    const fills = buildAss(id, cues, total).split('\n').filter((l) => /^Dialogue: \d,.*,(Main|RevL|RevR),/.test(l))
    assert.strictEqual(fills.length, cues.length, id)
    cues.forEach((c, i) => {
      const text = fills[i].slice(fills[i].indexOf('}', fills[i].indexOf(',,') ) + 1)
      const lines = text.split('\\N')
      const expected = cueLines(STYLE_PRESETS[id].emphasis ? c.words : c.words.map((w) => ({ ...w, emph: false })))
      assert.strictEqual(lines.length, expected.length, `${id} cue ${i}: ${text}`)
      // una línea con resaltada no lleva otra palabra
      lines.forEach((l, li) => {
        if (expected[li].some((w) => w.emph)) assert.strictEqual(expected[li].length, 1, `${id}: resaltada acompañada`)
        if (/\{\\c&H/.test(l)) assert(!/\{\\r[^}]*\}\s*\S/.test(l), `${id}: tras la resaltada no sigue otra palabra en su línea: ${l}`)
      })
    })
  }
  // el ejemplo del Playbook: APRENDER sola arriba y "tres trucos" debajo
  const ex = buildAss('chispa', [{ id: 'x', start: 0, end: 1, side: 'left', words: [W('aprender', true), W('tres'), W('trucos')] }], 1)
  assert(/APRENDER\{\\r\}\\Ntres trucos/.test(ex), ex.split('\n').find((l) => l.includes('APRENDER')))
})

// ---- Margen al borde y duración (manual VM pp. 14-15) ----
test('margen al borde: ningún bloque de texto queda pegado al borde, ni movido al extremo', () => {
  const canvases = [DEFAULT_CANVAS, { w: 1920, h: 1080 }]
  const pulls = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: -50, y: -50 }, { x: 50, y: -50 }, { x: -50, y: 50 }]
  for (const canvas of canvases) {
    for (const id of Object.keys(STYLE_PRESETS)) {
      const p = resolveStyle(STYLE_PRESETS[id])
      for (const pull of pulls) {
        const o = safeOffset(p, pull, canvas)
        for (const side of ['left', 'right']) {
          const [x0, y0, x1, y1] = textRect(p, side, o, canvas)
          const tag = `${id} ${canvas.w}x${canvas.h} ${JSON.stringify(pull)} ${side}`
          assert(x0 >= SAFE_MARGIN.x - 1e-9 && x1 <= 100 - SAFE_MARGIN.x + 1e-9, `${tag}: horizontal ${x0}-${x1}`)
          assert(y0 >= SAFE_MARGIN.y - 1e-9 && y1 <= 100 - SAFE_MARGIN.y + 1e-9, `${tag}: vertical ${y0}-${y1}`)
        }
      }
      // posición por defecto intacta (ya está dentro del margen)
      assert.deepStrictEqual(safeOffset(p, { x: 0, y: 0 }, canvas), { x: 0, y: 0 }, `${id}: el default no se mueve`)
    }
  }
  // el ASS aplica el mismo margen: Claro arrastrado al fondo queda dentro
  const ass = buildAss('claro', buildCues('claro', cut, segs), totalDuration(segs), undefined, { offset: { x: 0, y: 50 } })
  const y = +ass.split('\n').find((l) => l.startsWith('Dialogue:')).match(/\\pos\(\d+,(\d+)\)/)[1]
  assert(y / 1920 * 100 <= 100 - SAFE_MARGIN.y, `centro a ${y}px`)
})

test('duración: ningún subtítulo dura más que su clip ni que el video', () => {
  const total = totalDuration(segs)
  for (const id of Object.keys(STYLE_PRESETS)) {
    const cues = buildCues(id, cut, segs)
    for (const c of cues) {
      const seg = segs.find((s) => c.start >= s.tlStart - 1e-9 && c.start < s.tlEnd)
      assert(seg, `${id}: cue sin clip`)
      assert(c.end <= seg.tlEnd + 1e-9, `${id}: ${c.id} termina en ${c.end}, su clip en ${seg.tlEnd}`)
    }
    const ends = buildAss(id, cues, total).split('\n').filter((l) => l.startsWith('Dialogue:') && !l.includes(',Band,'))
      .map((l) => { const [h, m, sec] = l.split(',')[2].split(':'); return +h * 3600 + +m * 60 + +sec })
    assert(ends.every((e) => e <= total + 1e-9), `${id}: subtítulo más largo que el video`)
  }
  // un cue que se pasa del video se recorta al final; uno que empieza después no sale
  const long = buildAss('claro', [
    { id: 'a', start: total - 0.5, end: total + 3, side: 'left', words: [{ text: 'fin', emph: false }] },
    { id: 'b', start: total + 1, end: total + 2, side: 'left', words: [{ text: 'fuera', emph: false }] },
  ], total).split('\n').filter((l) => l.startsWith('Dialogue:'))
  assert(long.length > 0 && long.every((l) => l.includes('fin') && !l.includes('fuera')))
  assert(long.every((l) => l.split(',')[2] === '0:00:09.40'), long[0])
})

// ---- Texto movible e imágenes ----
test('texto movible: el ASS respeta el desplazamiento guardado en %', () => {
  const total = totalDuration(segs)
  const cues = buildCues('claro', cut, segs)
  const pos = (ass) => ass.split('\n').find((l) => l.startsWith('Dialogue:')).match(/\\pos\((\d+),(\d+)\)/).slice(1).map(Number)
  assert.deepStrictEqual(pos(buildAss('claro', cues, total)), [540, Math.round(0.595 * 1920)])
  // x pedido 10% → el margen seguro lo deja en 2% (el bloque de 84% no toca el borde)
  assert.deepStrictEqual(pos(buildAss('claro', cues, total, undefined, { offset: { x: 10, y: -20 } })), [Math.round(0.52 * 1080), Math.round(0.395 * 1920)])
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
  const dl = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
  assert(dl(hit).filter((l) => l.startsWith('Dialogue: 1,')).every((l) => l.includes(',MainShC,')), 'con imagen debajo, la capa de sombra usa la sombra de choque')
  assert.strictEqual(dl(hit).filter((l) => l.includes(',MainShC,')).length, cues.length, 'todas las frases chocan y llevan sombra')
  assert(!dl(free).some((l) => l.includes(',MainShC,')), 'sin choque no hay sombra de choque')
  const shc = hit.split('\n').find((l) => l.startsWith('Style: MainShC,')).split(',')
  assert.deepStrictEqual(shc.slice(16, 18), ['0', '2'], 'sombra de choque difusa, sin contorno')
  assert.strictEqual(shc[6], '&H73000000', 'sombra de choque negra al 55%')
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

test('watchdog: ffmpeg sin progreso se mata antes del techo y avanzando no se corta', async () => {
  assert.strictEqual(EXPORT_STALL_MS, 60_000)
  // espera fotogramas por stdin que nunca llegan: no hay progreso
  let t0 = Date.now()
  const err = await runFfmpeg(
    ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '16x16', '-i', 'pipe:0', '-f', 'null', '-'],
    undefined,
    { timeoutMs: 20_000, stallMs: 1500 }
  )
    .then(() => null)
    .catch((e) => e)
  assert(err instanceof FfmpegStallError, `debía ser FfmpegStallError: ${err}`)
  assert(Date.now() - t0 < 6000, `tardó ${Date.now() - t0} ms`)
  // un trabajo que avanza y dura más que la ventana del watchdog no se corta
  t0 = Date.now()
  await runFfmpeg(
    ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=r=10:d=3,realtime', '-f', 'null', '-'],
    undefined,
    { timeoutMs: 20_000, stallMs: 1500 }
  )
  assert(Date.now() - t0 >= 2500, 'debía correr ~3 s sin cortarse')
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
