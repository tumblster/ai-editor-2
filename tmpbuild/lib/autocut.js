"use strict";
// Autorrecorte — corre en el navegador sobre el JSON de transcripción.
// No destructivo: solo marca unidades como removed; el original nunca se toca.
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAutocut = applyAutocut;
exports.formatSummary = formatSummary;
const phrases_1 = require("./phrases");
const SILENCE_MIN = 0.5; // s: los silencios >= esto se quitan
const RETAKE_WINDOW = 30; // s: distancia máxima entre intentos repetidos
const RETAKE_MIN_WORDS = 2; // una repetión de 1 palabra no cuenta (falsos positivos)
/** Resetea los cortes previos y aplica las detecciones activadas. */
function applyAutocut(phrases, opts) {
    const out = phrases.map((p) => ({
        ...p,
        words: p.words,
        removed: false,
        reason: undefined,
    }));
    if (opts.silences) {
        for (const p of out) {
            if (p.kind === 'gap' && p.end - p.start >= SILENCE_MIN) {
                p.removed = true;
                p.reason = 'silence';
            }
        }
    }
    if (opts.fillers) {
        for (const p of out) {
            if (p.kind === 'phrase' && p.isFiller) {
                p.removed = true;
                p.reason = 'filler';
            }
        }
    }
    if (opts.retakes) {
        detectRetakes(out);
    }
    const summary = { seconds: 0, silences: 0, fillers: 0, retakes: 0 };
    for (const p of out) {
        if (!p.removed)
            continue;
        summary.seconds += p.end - p.start;
        if (p.reason === 'silence')
            summary.silences++;
        else if (p.reason === 'filler')
            summary.fillers++;
        else if (p.reason === 'retake')
            summary.retakes++;
    }
    return { phrases: out, summary };
}
/**
 * Retakes: frases repetidas — se queda solo el último intento completo.
 * Se comparan "runs de habla" (frases contiguas sin gap ni muletilla): si un
 * run posterior empieza con el texto de uno anterior (y el intento anterior
 * terminó abandonado — seguido de silencio o muletilla), el anterior es un
 * retake y se marca. Conservador: requiere pausa/muletilla entre intentos.
 */
function detectRetakes(phrases) {
    const normText = (p) => p.words.map((w) => (0, phrases_1.normalizeWord)(w.word)).filter(Boolean).join(' ');
    // runs de habla contiguos
    const runs = [];
    let cur = [];
    let prev = null;
    const flushRun = () => {
        if (!cur.length)
            return;
        const text = cur.map(normText).filter(Boolean).join(' ');
        const last = cur[cur.length - 1];
        const next = phrases.find((p) => p.videoId === last.videoId && p.start >= last.end - 0.01);
        const abandonedAfter = !next || next.kind === 'gap' || next.isFiller === true;
        runs.push({ units: cur, text, end: last.end, abandonedAfter });
        cur = [];
    };
    for (const p of phrases) {
        const isSpeakable = p.kind === 'phrase' && !p.isFiller;
        if (!isSpeakable) {
            flushRun();
            prev = p;
            continue;
        }
        const contiguous = prev !== null && prev.videoId === p.videoId && p.start - prev.end < 0.05;
        if (!contiguous)
            flushRun();
        cur.push(p);
        prev = p;
    }
    flushRun();
    const used = new Set();
    for (let a = 0; a < runs.length - 1; a++) {
        const A = runs[a];
        if (!A.abandonedAfter)
            continue;
        const wordsA = A.text.split(' ').filter(Boolean);
        if (wordsA.length < RETAKE_MIN_WORDS)
            continue;
        for (let b = a + 1; b < runs.length; b++) {
            const B = runs[b];
            if (B.units[0].videoId !== A.units[0].videoId)
                break;
            if (B.units[0].start - A.end > RETAKE_WINDOW)
                break;
            if (B.units.some((p) => used.has(p.id)))
                continue;
            const wordsB = B.text.split(' ').filter(Boolean);
            // el intento nuevo repite el texto anterior y lo continúa (o lo repite igual)
            const repeats = wordsB.length >= wordsA.length &&
                wordsA.every((w, i) => wordsB[i] === w);
            if (!repeats)
                continue;
            for (const p of A.units) {
                const target = phrases.find((x) => x.id === p.id);
                if (target) {
                    target.removed = true;
                    target.reason = 'retake';
                }
                used.add(p.id);
            }
            break;
        }
    }
}
/** Resumen exacto: Se quitaron X segundos — Y silencios · Z muletillas · W retakes (omite ceros). */
function formatSummary(s) {
    const parts = [];
    if (s.silences > 0)
        parts.push(`${s.silences} silencios`);
    if (s.fillers > 0)
        parts.push(`${s.fillers} muletillas`);
    if (s.retakes > 0)
        parts.push(`${s.retakes} retakes`);
    const secs = Math.max(Math.round(s.seconds), 0);
    if (parts.length === 0)
        return `Se quitaron ${secs} segundos`;
    return `Se quitaron ${secs} segundos — ${parts.join(' · ')}`;
}
