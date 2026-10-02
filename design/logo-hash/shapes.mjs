#!/usr/bin/env node
// Формы наклонной решётки «#» — одна палитра (белым на чёрном), разная геометрия:
// наклон, толщина, скругление концов, размер знака, сдвиг горизонталей.
//
//   node design/logo-hash/shapes.mjs
//
// Пишет shapes/<id>.svg и shapes-sheet.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = dirname(fileURLToPath(import.meta.url));

/**
 * Решётка из четырёх линий на сетке 64×64.
 * slant — наклон вертикалей (град.), w — толщина, cap — round|butt|square,
 * size — половина размаха знака, gap — расстояние между параллельными,
 * shift — горизонтали сдвинуты по x (как у рукописного #), hslant — наклон горизонталей.
 */
function grid({ slant = 18, w = 6, cap = 'round', size = 17, gap = 12, shift = 0, hslant = 0 } = {}) {
  const k = Math.tan((slant * Math.PI) / 180);
  const hk = Math.tan((hslant * Math.PI) / 180);
  const c = 32;
  const lines = [];
  for (const dx of [-gap / 2, gap / 2]) {
    // Вертикаль через (c+dx, c), наклон вправо вверх.
    lines.push([c + dx + size * k, c - size, c + dx - size * k, c + size]);
  }
  for (const [i, dy] of [[0, -gap / 2], [1, gap / 2]]) {
    const sx = i === 0 ? shift : -shift;
    lines.push([c - size + sx, c + dy + size * hk, c + size + sx, c + dy - size * hk]);
  }
  return lines
    .map(([x1, y1, x2, y2]) => `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`)
    .join('');
}

const mark = (bg, fg, opts) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="15" fill="${bg}"/>` +
  `<g stroke="${fg}" stroke-width="${opts.w ?? 6}" stroke-linecap="${opts.cap ?? 'round'}">${grid(opts)}</g></svg>`;

const B = '#0a0a0a';
const W = '#ffffff';
const shapes = [
  ['a1', 'Наклон 18°, скруглённые', {}],
  ['a2', 'Наклон 25°, скруглённые', { slant: 25 }],
  ['a3', 'Наклон 30°, сильный', { slant: 30, size: 16 }],
  ['a4', 'Наклон 18°, тонкий', { w: 4.5 }],
  ['a5', 'Наклон 18°, жирный', { w: 8, gap: 13 }],
  ['a6', 'Наклон 18°, рубленые концы', { cap: 'butt', size: 18 }],
  ['a7', 'Наклон 25°, мельче', { slant: 25, size: 14, gap: 10, w: 5 }],
  ['a8', 'Наклон 25°, крупнее', { slant: 25, size: 20, gap: 14, w: 6.5 }],
  ['a9', 'Горизонтали сдвинуты', { slant: 22, shift: 3 }],
  ['a10', 'Горизонтали тоже с наклоном', { slant: 22, hslant: 6 }],
  ['a11', 'Широкая решётка', { slant: 20, gap: 16, size: 18 }],
  ['a12', 'Узкая решётка', { slant: 20, gap: 9, size: 17, w: 5 }],
];

mkdirSync(join(OUT, 'shapes'), { recursive: true });
const all = [];
for (const [id, label, o] of shapes) {
  const dark = mark(B, W, o);
  const light = mark(W, B, o);
  writeFileSync(join(OUT, 'shapes', `${id}.svg`), dark);
  all.push([id, label, dark, light]);
}

const COLS = 4;
const CW = 300;
const CH = 250;
const SW = COLS * CW + 40;
const SH = Math.ceil(all.length / COLS) * CH + 80;
const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const place = (s, x, y, size) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 64 64">${inner(s)}</svg>`;
let cells = '';
all.forEach(([id, label, dark, light], i) => {
  const x = 20 + (i % COLS) * CW;
  const y = 70 + Math.floor(i / COLS) * CH;
  cells +=
    place(dark, x + 10, y, 150) +
    place(light, x + 180, y, 64) +
    place(dark, x + 180, y + 80, 32) +
    place(dark, x + 222, y + 88, 16) +
    place(light, x + 246, y + 88, 16) +
    `<text x="${x + 10}" y="${y + 182}" font-family="sans-serif" font-size="15" fill="#111">${id} · ${label}</text>`;
});
writeFileSync(
  join(OUT, 'shapes-sheet.png'),
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" fill="#e4e4e7"/>` +
      `<text x="30" y="44" font-family="sans-serif" font-size="24" font-weight="700" fill="#111">microdocs — наклонная решётка «#», формы</text>${cells}</svg>`,
    { font: { loadSystemFonts: true } },
  ).render().asPng(),
);
console.log(`${shapes.length} форм → ${OUT}`);
