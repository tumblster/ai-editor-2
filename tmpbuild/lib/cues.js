"use strict";
// Cues de subtítulos: cómo se agrupa y resalta el texto quemado según el estilo.
// Compartido entre preview (client) y export (server) para que coincidan.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNumberWord = isNumberWord;
exports.markEmph = markEmph;
exports.buildCues = buildCues;
exports.activeCue = activeCue;
const presets_1 = require("./styles/presets");
const STOPWORDS = new Set([
    'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'una',
    'para', 'con', 'no', 'su', 'al', 'lo', 'como', 'más', 'mas', 'pero', 'le', 'ya', 'o',
    'sus', 'me', 'mi', 'te', 'esta', 'este', 'esto', 'ese', 'eso', 'son', 'fue', 'era',
    'muy', 'también', 'tambien', 'así', 'asi', 'hacer', 'tiene', 'puedo', 'puede', 'vamos',
    'siento', 'nada', 'todo', 'todos',
]);
function isNumberWord(text) {
    return /[\d%€$]|(?:mil|milón|millon|millón|millones)/i.test(text);
}
function keywordIndex(texts) {
    let best = -1;
    let bestScore = 0;
    texts.forEach((t, i) => {
        const clean = t.replace(/[^\p{L}\p{N}%€$]/gu, '');
        if (!clean)
            return;
        const score = clean.length + (STOPWORDS.has(clean.toLowerCase()) ? -100 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}
/** Qué palabras van destacadas según el scope del énfasis (keyword o números). */
function markEmph(scope, texts) {
    if (scope === 'numbers')
        return texts.map((t) => isNumberWord(t));
    const kIdx = keywordIndex(texts);
    return texts.map((_, i) => i === kIdx);
}
function isEmph(scope, texts, i, kIdx) {
    if (scope === 'numbers')
        return isNumberWord(texts[i]);
    return i === kIdx;
}
function buildCues(styleId, phrases, segments) {
    const preset = presets_1.STYLE_PRESETS[styleId];
    const byId = new Map(phrases.map((p) => [p.id, p]));
    const cues = [];
    let flip = 0;
    for (const seg of segments) {
        const unit = byId.get(seg.unitId);
        if (!unit || unit.kind !== 'phrase' || !unit.words.length)
            continue;
        const remap = (t) => seg.tlStart + (t - seg.srcStart);
        const chunks = [];
        const step = Math.max(1, preset.cueWords);
        for (let i = 0; i < unit.words.length; i += step)
            chunks.push(unit.words.slice(i, i + step));
        chunks.forEach((chunk, ci) => {
            const texts = chunk.map((w) => w.word.trim());
            const kIdx = keywordIndex(texts);
            const words = texts.map((text, i) => ({
                text,
                emph: preset.emphasis ? isEmph(preset.emphasis.scope, texts, i, kIdx) : false,
            }));
            const start = remap(chunk[0].start);
            const end = ci === chunks.length - 1 ? seg.tlEnd : remap(chunk[chunk.length - 1].end);
            cues.push({
                id: `${unit.id}-c${ci}`,
                start,
                end,
                words,
                side: flip++ % 2 === 0 ? 'left' : 'right',
            });
        });
    }
    return cues;
}
function activeCue(cues, t) {
    for (const c of cues) {
        if (t >= c.start - 0.02 && t <= c.end + 0.05)
            return c;
    }
    return null;
}
