"use strict";
// Parámetros cerrados de los cinco estilos predefinidos de Fase 1.
// Nombres públicos exactos; nunca nombres de creadores (ni aquí, ni en UI, ni en marketing).
// Los mismos números alimentan el render de preview (CSS) y el quemado de export (ASS),
// para que lo que se ve sea lo que sale en el MP4.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STYLE_IDS = exports.STYLE_PRESETS = exports.DESIGN_H = exports.DESIGN_W = void 0;
// Lienzo de diseño: el export es 1080x1920 (9:16) y el preview escala desde aquí.
exports.DESIGN_W = 1080;
exports.DESIGN_H = 1920;
exports.STYLE_PRESETS = {
    chispa: {
        id: 'chispa',
        name: 'Chispa',
        base: {
            font: 'Trebuchet MS', bold: true, italic: false, size: 88,
            color: '#F5E9CE', outlineWidth: 0, outlineColor: '#000000', outlineAlpha: 0,
            shadowOffset: 5, shadowAlpha: 0.55,
        },
        cueWords: 3,
        placement: { kind: 'center', yPercent: 31.5 },
        emphasis: { scope: 'keyword', uppercase: true, scale: 1.3, color: '#FFF7E0', italic: false },
    },
    revista: {
        id: 'revista',
        name: 'Revista',
        base: {
            font: 'Georgia', bold: false, italic: false, size: 56,
            color: '#FFFFFF', outlineWidth: 0, outlineColor: '#000000', outlineAlpha: 0,
            shadowOffset: 3, shadowAlpha: 0.5,
        },
        cueWords: 5,
        placement: {
            kind: 'blocks',
            left: [8, 38], right: [60, 85], band: [35, 45], bandAlpha: 0.14,
        },
        emphasis: null,
    },
    titular: {
        id: 'titular',
        name: 'Titular',
        base: {
            font: 'Arial', bold: true, italic: false, size: 64,
            color: '#FFFFFF', outlineWidth: 0, outlineColor: '#000000', outlineAlpha: 0,
            shadowOffset: 4, shadowAlpha: 0.55,
        },
        cueWords: 5,
        placement: { kind: 'center', yPercent: 49.5 },
        emphasis: {
            scope: 'keyword', uppercase: false, scale: 1.5, color: '#F7E01C', italic: true,
            font: 'Georgia', outlineWidth: 1.5, outlineAlpha: 0.8,
        },
    },
    claro: {
        id: 'claro',
        name: 'Claro',
        base: {
            font: 'Arial', bold: true, italic: false, size: 60,
            color: '#FFFFFF', outlineWidth: 0, outlineColor: '#000000', outlineAlpha: 0,
            shadowOffset: 3, shadowAlpha: 0.5,
        },
        cueWords: 5,
        placement: { kind: 'center', yPercent: 59.5 },
        emphasis: { scope: 'keyword', uppercase: false, scale: 1.0, color: '#F9EEAF', italic: false },
    },
    foco: {
        id: 'foco',
        name: 'Foco',
        base: {
            font: 'Trebuchet MS', bold: true, italic: false, size: 58,
            color: '#FFFFFF', outlineWidth: 2.5, outlineColor: '#0C0C10', outlineAlpha: 0.9,
            shadowOffset: 2, shadowAlpha: 0.4,
        },
        cueWords: 5,
        placement: { kind: 'center', yPercent: 70 },
        emphasis: { scope: 'numbers', uppercase: false, scale: 1.15, color: '#FFD84D', italic: false },
    },
};
exports.STYLE_IDS = Object.keys(exports.STYLE_PRESETS);
