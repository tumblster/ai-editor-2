"use strict";
// Agrupa la transcripción en frases de 3 a 5 palabras máximo.
// Cada frase es una unidad de corte; nunca se parte a mitad de palabra.
// Las muletillas van sueltas (unidad propia) para poder quitarlas con precisión.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWord = normalizeWord;
exports.buildPhrases = buildPhrases;
const FILLER_SINGLE = new Set([
    'eh', 'e', 'ee', 'eee', 'ehh', 'em', 'emm', 'ehm', 'ah', 'ahh', 'aah',
    'mm', 'mmm', 'hm', 'hmm', 'mhm', 'uh', 'um', 'ay',
]);
const FILLER_MULTI = new Set(['o sea']);
const MIN_GAP_UNIT = 0.25; // s: hueco menor se absorbe en la frase vecina
const MAX_WORDS = 5;
const MIN_WORDS = 3;
const PAUSE_BREAK = 0.6; // s de pausa que cierra una frase con >= 3 palabras
function normalizeWord(w) {
    return w
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s%€$]/gu, '')
        .trim();
}
function mkUnit(videoId, index, kind, words, start, end, isFiller = false) {
    return {
        id: `${videoId}-u${index}`,
        videoId,
        kind,
        text: words.map((w) => w.word.trim()).join(' ').replace(/\s+/g, ' ').trim(),
        start,
        end,
        words,
        removed: false,
        isFiller,
    };
}
/** Construye las unidades de un video: particionan [0, duración] sin huecos ni solapes. */
function buildPhrases(videoId, tr) {
    var _a, _b;
    const words = ((_a = tr.words) !== null && _a !== void 0 ? _a : []).filter((w) => w.end > w.start && w.word.trim());
    const duration = Math.max((_b = tr.duration) !== null && _b !== void 0 ? _b : 0, words.length ? words[words.length - 1].end : 0);
    if (!words.length) {
        return duration > 0 ? [mkUnit(videoId, 0, 'gap', [], 0, duration)] : [];
    }
    const drafts = [];
    let current = [];
    const flush = (filler = false) => {
        if (current.length)
            drafts.push({ words: current, filler });
        current = [];
    };
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const nw = normalizeWord(w.word);
        const next = words[i + 1];
        const gapAfter = next ? next.start - w.end : Infinity;
        // Muletilla de una palabra
        if (FILLER_SINGLE.has(nw)) {
            flush();
            drafts.push({ words: [w], filler: true });
            continue;
        }
        // Muletilla de dos palabras ("o sea")
        if (next && FILLER_MULTI.has(`${nw} ${normalizeWord(next.word)}`)) {
            flush();
            drafts.push({ words: [w, next], filler: true });
            i++;
            continue;
        }
        current.push(w);
        // "este" suelto seguido de pausa es muletilla
        if (current.length === 1 && nw === 'este' && gapAfter > 0.5) {
            flush(true);
            continue;
        }
        const count = current.length;
        const endsSentence = /[.!?…]$/.test(w.word.trim());
        const nextIsFiller = next
            ? FILLER_SINGLE.has(normalizeWord(next.word)) ||
                FILLER_MULTI.has(`${nw} ${normalizeWord(next.word)}`)
            : false;
        if (count >= MAX_WORDS)
            flush();
        else if (count >= MIN_WORDS && (endsSentence || gapAfter > PAUSE_BREAK || nextIsFiller))
            flush();
    }
    flush();
    // Frase corta final (1-2 palabras) se une a la anterior si cabe
    const merged = [];
    for (const d of drafts) {
        const prev = merged[merged.length - 1];
        if (!d.filler &&
            prev &&
            !prev.filler &&
            prev.words.length + d.words.length <= MAX_WORDS &&
            d.words[0].start - prev.words[prev.words.length - 1].end < PAUSE_BREAK) {
            prev.words.push(...d.words);
        }
        else {
            merged.push({ ...d, words: [...d.words] });
        }
    }
    // Particionar [0, duration] con huecos (silencios) entre frases
    const units = [];
    let idx = 0;
    const pushGap = (start, end) => {
        if (end - start >= MIN_GAP_UNIT)
            units.push(mkUnit(videoId, idx++, 'gap', [], start, end));
    };
    let cursor = 0;
    for (const d of merged) {
        const start = Math.max(0, d.words[0].start);
        const end = Math.min(duration, d.words[d.words.length - 1].end);
        if (end - start <= 0.01)
            continue;
        if (start - cursor >= MIN_GAP_UNIT)
            pushGap(cursor, start);
        else if (start > cursor) {
            // hueco pequeño: lo absorbe la frase anterior extendiéndola
            const prev = units[units.length - 1];
            if (prev)
                prev.end = Math.min(duration, Math.max(prev.end, start));
        }
        units.push(mkUnit(videoId, idx++, 'phrase', d.words, start, end, d.filler));
        cursor = Math.max(cursor, end);
    }
    if (duration - cursor >= MIN_GAP_UNIT)
        pushGap(cursor, duration);
    else if (units.length)
        units[units.length - 1].end = duration;
    // Sanear: la primera unidad empieza en 0, start < end y contigüidad exacta
    if (units.length && units[0].start > 0)
        units[0].start = 0;
    for (let i = 0; i < units.length; i++) {
        if (i > 0 && units[i].start < units[i - 1].end)
            units[i].start = units[i - 1].end;
        if (units[i].end <= units[i].start)
            units[i].end = units[i].start + 0.05;
    }
    return units;
}
