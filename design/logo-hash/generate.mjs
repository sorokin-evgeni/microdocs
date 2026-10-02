#!/usr/bin/env node
// Варианты логотипа «#»: плоские и объёмные, в разных цветах.
//
//   node design/logo-hash/generate.mjs
//
// Пишет рядом svg/<id>.svg, png/<id>.png (512 px) и sheet.png — сводный лист,
// где каждый вариант показан крупно, в 32 px и в 16 px (как фавиконка).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = dirname(fileURLToPath(import.meta.url));

/** «#» на сетке 64×64 залитыми прямоугольниками; slant — наклон вертикалей в градусах. */
function hash({ bar = 6, slant = 12, inset = 13 } = {}) {
  const k = Math.tan((slant * Math.PI) / 180);
  const sx = (x, y) => +(x + (32 - y) * k).toFixed(2);
  const lo = inset;
  const hi = 64 - inset;
  const rects = [];
  // Вертикали — параллелограммы с наклоном.
  for (const cx of [25, 39]) {
    const x0 = cx - bar / 2;
    const x1 = cx + bar / 2;
    rects.push([[sx(x0, lo), lo], [sx(x1, lo), lo], [sx(x1, hi), hi], [sx(x0, hi), hi]]);
  }
  // Горизонтали.
  for (const cy of [25, 39]) {
    const y0 = cy - bar / 2;
    const y1 = cy + bar / 2;
    rects.push([[lo, y0], [hi, y0], [hi, y1], [lo, y1]]);
  }
  return rects.map((p) => 'M' + p.map(([x, y]) => `${x} ${y}`).join('L') + 'Z').join('');
}

const tile = (fill) => `<rect width="64" height="64" rx="15" fill="${fill}"/>`;
const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const clip = '<clipPath id="t"><rect width="64" height="64" rx="15"/></clipPath>';

/** Плоский: цветная плитка, знак одним цветом. */
const flat = (bg, fg, opts) => svg(tile(bg) + `<path d="${hash(opts)}" fill="${fg}"/>`);

/** Выдавленный: стопка сдвинутых копий тёмным цветом, сверху лицевая грань. */
function extruded(bg, face, side, depth = 4, opts) {
  const d = hash(opts);
  let layers = '';
  for (let i = depth; i >= 1; i -= 0.5) layers += `<path d="${d}" fill="${side}" transform="translate(${i * 0.7} ${i})"/>`;
  return svg(tile(bg) + layers + `<path d="${d}" fill="${face}"/>`);
}

/** Длинная тень под 45° до края плитки. */
function longShadow(bg, fg, shadow, opts) {
  const d = hash(opts);
  let layers = '';
  for (let i = 40; i >= 1; i--) layers += `<path d="${d}" fill="${shadow}" transform="translate(${i} ${i})"/>`;
  return svg(tile(bg) + `<g clip-path="url(#t)">${layers}</g><path d="${d}" fill="${fg}"/>`, clip);
}

/** Глянцевый: градиентная плитка, знак с градиентом, бликом сверху и мягкой тенью. */
function glossy([bg1, bg2], [fg1, fg2], shadow, opts) {
  const d = hash(opts);
  const defs =
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>` +
    `<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fg1}"/><stop offset="1" stop-color="${fg2}"/></linearGradient>` +
    `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.2" stdDeviation="1.8" flood-color="${shadow}" flood-opacity=".55"/></filter>`;
  return svg(
    `<rect width="64" height="64" rx="15" fill="url(#bg)"/>` +
      `<path d="M0 15A15 15 0 0 1 15 0H49A15 15 0 0 1 64 15V30Q32 38 0 30Z" fill="url(#sheen)"/>` +
      `<g filter="url(#sh)"><path d="${d}" fill="#fff" fill-opacity=".9" transform="translate(0 -0.8)"/><path d="${d}" fill="url(#fg)"/></g>`,
    defs,
  );
}

/** Неоморфизм: светлая плитка, знак выдавлен светом и тенью. */
function soft(bg, fg, light, dark, opts) {
  const d = hash(opts);
  const defs =
    `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>`;
  return svg(
    tile(bg) +
      `<path d="${d}" fill="${dark}" filter="url(#b)" transform="translate(1.6 1.6)"/>` +
      `<path d="${d}" fill="${light}" filter="url(#b)" transform="translate(-1.6 -1.6)"/>` +
      `<path d="${d}" fill="${fg}"/>`,
    defs,
  );
}

const straight = { slant: 0 };
const variants = [
  // Плоские
  ['01-flat-black', 'Плоский · чёрный', flat('#0a0a0a', '#ffffff')],
  ['02-flat-white', 'Плоский · белый', flat('#ffffff', '#0a0a0a')],
  ['03-flat-blue', 'Плоский · синий', flat('#2563eb', '#ffffff')],
  ['04-flat-orange', 'Плоский · оранжевый', flat('#f97316', '#ffffff')],
  ['05-flat-green', 'Плоский · зелёный', flat('#16a34a', '#ffffff')],
  ['06-flat-violet', 'Плоский · фиолетовый', flat('#7c3aed', '#ffffff')],
  ['07-flat-yellow', 'Плоский · жёлтый', flat('#facc15', '#111111')],
  ['08-flat-red-straight', 'Плоский · красный, прямой', flat('#dc2626', '#ffffff', straight)],
  ['09-flat-ink-lime', 'Плоский · лайм на чёрном', flat('#111827', '#a3e635')],
  ['10-flat-thin-navy', 'Плоский · тонкий, тёмно-синий', flat('#1e293b', '#e2e8f0', { bar: 4.5 })],
  // Объёмные
  ['11-extruded-blue', 'Объём · выдавленный, синий', extruded('#3b82f6', '#ffffff', '#1e3a8a')],
  ['12-extruded-coral', 'Объём · выдавленный, коралл', extruded('#fb7185', '#fff7ed', '#9f1239')],
  ['13-longshadow-teal', 'Объём · длинная тень, бирюза', longShadow('#14b8a6', '#ffffff', '#0f766e')],
  ['14-longshadow-orange', 'Объём · длинная тень, оранж', longShadow('#f97316', '#ffffff', '#c2410c')],
  ['15-glossy-indigo', 'Объём · глянец, индиго', glossy(['#6366f1', '#3730a3'], ['#ffffff', '#c7d2fe'], '#1e1b4b')],
  ['16-glossy-dark', 'Объём · глянец, графит', glossy(['#374151', '#0b0f19'], ['#ffffff', '#9ca3af'], '#000000')],
  ['17-glossy-sunset', 'Объём · глянец, закат', glossy(['#f59e0b', '#db2777'], ['#ffffff', '#fde68a'], '#7c2d12')],
  ['18-glossy-mint', 'Объём · глянец, мята', glossy(['#34d399', '#047857'], ['#ffffff', '#d1fae5'], '#064e3b')],
  ['19-soft-light', 'Объём · мягкий, светлый', soft('#e5e7eb', '#e5e7eb', '#ffffff', '#9ca3af')],
  ['20-extruded-violet', 'Объём · выдавленный, фиолет', extruded('#ede9fe', '#8b5cf6', '#4c1d95', 4, straight)],
];

mkdirSync(join(OUT, 'svg'), { recursive: true });
mkdirSync(join(OUT, 'png'), { recursive: true });
const render = (s, w) => new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng();

for (const [id, , s] of variants) {
  writeFileSync(join(OUT, 'svg', `${id}.svg`), s);
  writeFileSync(join(OUT, 'png', `${id}.png`), render(s, 512));
}

// Сводный лист: 4 колонки, в ячейке крупно 160 px, рядом 32 и 16 px, подпись.
const COLS = 4;
const CW = 300;
const CH = 230;
const rows = Math.ceil(variants.length / COLS);
const W = COLS * CW + 40;
const H = rows * CH + 90;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const scoped = (s, id) => s.replace(/id="(\w+)"/g, `id="$1-${id}"`).replace(/url\(#(\w+)\)/g, `url(#$1-${id})`);
let cells = '';
variants.forEach(([id, label, s], i) => {
  const x = 20 + (i % COLS) * CW;
  const y = 70 + Math.floor(i / COLS) * CH;
  const body = inner(scoped(s, id.slice(0, 2)));
  const place = (px, py, size) =>
    `<svg x="${px}" y="${py}" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`;
  cells +=
    place(x + 10, y, 160) +
    place(x + 190, y + 40, 32) +
    place(x + 238, y + 48, 16) +
    `<text x="${x + 10}" y="${y + 190}" font-family="sans-serif" font-size="15" fill="#111">${esc(label)}</text>` +
    `<text x="${x + 10}" y="${y + 208}" font-family="monospace" font-size="12" fill="#777">${id}</text>`;
});
const sheet =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="#f4f4f5"/>` +
  `<text x="30" y="44" font-family="sans-serif" font-size="24" font-weight="700" fill="#111">microdocs — логотип «#»</text>` +
  cells +
  `</svg>`;
writeFileSync(join(OUT, 'sheet.png'), new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());
console.log(`${variants.length} вариантов → ${OUT}`);
