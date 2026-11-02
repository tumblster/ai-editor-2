"use strict";
// Mapeos entre tiempo fuente (cada video) y tiempo de línea de tiempo (= tiempo de export).
// Puro y compartido: lo usan preview, timeline y export.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCutSegments = buildCutSegments;
exports.totalDuration = totalDuration;
exports.segmentAt = segmentAt;
exports.timelineToSrc = timelineToSrc;
exports.srcToTimeline = srcToTimeline;
exports.formatTime = formatTime;
/** Segmentos mantenidos, en orden de video y de tiempo — la lista de cortes. */
function buildCutSegments(videos, phrases) {
    var _a;
    const videoIndex = new Map(videos.map((v, i) => [v.id, i]));
    const kept = phrases
        .filter((p) => !p.removed && p.end > p.start)
        .filter((p) => videoIndex.has(p.videoId))
        .sort((a, b) => {
        var _a, _b;
        const va = (_a = videoIndex.get(a.videoId)) !== null && _a !== void 0 ? _a : 0;
        const vb = (_b = videoIndex.get(b.videoId)) !== null && _b !== void 0 ? _b : 0;
        return va !== vb ? va - vb : a.start - b.start;
    });
    const segments = [];
    let tl = 0;
    for (const u of kept) {
        segments.push({
            unitId: u.id,
            videoId: u.videoId,
            videoIndex: (_a = videoIndex.get(u.videoId)) !== null && _a !== void 0 ? _a : 0,
            srcStart: u.start,
            srcEnd: u.end,
            tlStart: tl,
            tlEnd: tl + (u.end - u.start),
        });
        tl += u.end - u.start;
    }
    return segments;
}
function totalDuration(segments) {
    return segments.length ? segments[segments.length - 1].tlEnd : 0;
}
/** Segmento activo en el tiempo t de la línea de tiempo. */
function segmentAt(segments, t) {
    if (!segments.length)
        return null;
    if (t < 0)
        t = 0;
    for (let i = 0; i < segments.length; i++) {
        if (t < segments[i].tlEnd || i === segments.length - 1)
            return segments[i];
    }
    return null;
}
/** Tiempo fuente del video que se reproduce en el tiempo t de la línea de tiempo. */
function timelineToSrc(segments, t) {
    const seg = segmentAt(segments, t);
    if (!seg)
        return null;
    const local = Math.min(Math.max(t - seg.tlStart, 0), seg.tlEnd - seg.tlStart);
    return { videoIndex: seg.videoIndex, srcTime: seg.srcStart + local, seg };
}
/** Tiempo de línea de tiempo de un tiempo fuente concreto (fuera de segmentos → límite más cercano). */
function srcToTimeline(segments, videoId, srcTime) {
    for (const s of segments) {
        if (s.videoId !== videoId)
            continue;
        if (srcTime < s.srcStart)
            return s.tlStart;
        if (srcTime <= s.srcEnd)
            return s.tlStart + (srcTime - s.srcStart);
    }
    // después del último segmento del video → fin del siguiente segmento en la línea
    const after = segments.find((s) => s.videoId === videoId && s.srcStart > srcTime);
    return after ? after.tlStart : totalDuration(segments);
}
function formatTime(s) {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
