#!/usr/bin/env node
// Форма a1 (наклонная решётка 18°, скруглённые концы) в разных цветах —
// плоские и объёмные.
//
//   node design/logo-hash/colors.mjs
//
// Пишет a1/<id>.svg, a1/<id>.png (512 px) и a1-sheet.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = dirname(fileURLToPath(import.meta.url));

// Геометрия a1: наклон 18°, штрих 6, половина размаха 17, шаг решётки 12.
const W = 6;
const K = Math.tan((18 * Math.PI) / 180);
const S = 17;
const G = 12;
const C = 32;
const LINES = [
  [C - G / 2 + S * K, C - S, C - G / 2 - S * K, C + S],
  [C + G / 2 + S * K, C - S, C + G / 2 - S * K, C + S],
  [C - S, C - G / 2, C + S, C - G / 2],
  [C - S, C + G / 2, C + S, C + G / 2],
];
const lines = LINES.map(
  ([x1, y1, x2, y2]) => `<line x1="${x1.toFixed(2)}" y1="${y1}" x2="${x2.toFixed(2)}" y2="${y2}"/>`,
).join('');
/** Знак одним штрихом; stroke — цвет или url(#…), extra — атрибуты группы. */
const mark = (stroke, extra = '') =>
  `<g fill="none" stroke="${stroke}" stroke-width="${W}" stroke-linecap="round" ${extra}>${lines}</g>`;

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const tile = (fill) => `<rect width="64" height="64" rx="15" fill="${fill}"/>`;
// Градиенты в координатах плитки: у горизонтальной линии нулевая высота,
// и градиент «по рамке объекта» на ней не рисуется.
const vgrad = (id, a, b, y1 = 0, y2 = 64) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="0" y2="${y2}">` +
  `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const dgrad = (id, a, b) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">` +
  `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const flat = (bg, fg) => svg(tile(bg) + mark(fg));

/** Выдавленный вниз-вправо: стопка копий тёмным, сверху лицевой цвет. */
function extruded(bg, face, side, depth = 3) {
  let s = '';
  for (let i = depth; i > 0; i -= 0.5) s += mark(side, `transform="translate(${i * 0.6} ${i})"`);
  return svg(tile(bg) + s + mark(face));
}

/** Длинная тень под 45° до края плитки. */
function longShadow(bg, fg, shadow) {
  let s = '';
  for (let i = 40; i >= 1; i--) s += mark(shadow, `transform="translate(${i} ${i})"`);
  return svg(
    tile(bg) + `<g clip-path="url(#t)">${s}</g>` + mark(fg),
    '<clipPath id="t"><rect width="64" height="64" rx="15"/></clipPath>',
  );
}

/** Глянец: плитка-градиент с бликом, знак с вертикальным градиентом и мягкой тенью. */
function glossy([b1, b2], [f1, f2], shadow) {
  const defs =
    dgrad('bg', b1, b2) +
    vgrad('fg', f1, f2, 15, 49) +
    vgrad('sheen', 'rgba(255,255,255,.28)', 'rgba(255,255,255,0)', 0, 32) +
    `<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="${shadow}" flood-opacity=".6"/></filter>`;
  return svg(
    `<rect width="64" height="64" rx="15" fill="url(#bg)"/>` +
      `<path d="M0 15A15 15 0 0 1 15 0H49A15 15 0 0 1 64 15V28Q32 36 0 28Z" fill="url(#sheen)"/>` +
      `<g filter="url(#sh)">${mark('url(#fg)')}</g>`,
    defs,
  );
}

/** Знак-градиент на тёмной плитке, без объёма — «неоновый». */
function neon(bg, a, b, glow) {
  const defs =
    dgrad('g', a, b) +
    `<filter id="gl" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2"/></filter>`;
  return svg(tile(bg) + `<g opacity=".7" filter="url(#gl)">${mark(glow)}</g>` + mark('url(#g)'), defs);
}

/** Мягкий: светлая плитка, знак приподнят светом сверху-слева и тенью снизу-справа. */
function soft(bg, fg, light, dark) {
  const defs = `<filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.3"/></filter>`;
  return svg(
    tile(bg) +
      `<g filter="url(#b)">${mark(dark, 'transform="translate(1.5 1.5)"')}</g>` +
      `<g filter="url(#b)">${mark(light, 'transform="translate(-1.5 -1.5)"')}</g>` +
      mark(fg),
    defs,
  );
}

const variants = [
  // Плоские
  ['01-black', 'Плоский · белый на чёрном', flat('#0a0a0a', '#ffffff')],
  ['02-white', 'Плоский · чёрный на белом', flat('#ffffff', '#0a0a0a')],
  ['03-blue', 'Плоский · синий', flat('#2563eb', '#ffffff')],
  ['04-indigo', 'Плоский · индиго', flat('#4f46e5', '#ffffff')],
  ['05-violet', 'Плоский · фиолетовый', flat('#7c3aed', '#ffffff')],
  ['06-green', 'Плоский · зелёный', flat('#16a34a', '#ffffff')],
  ['07-teal', 'Плоский · бирюза', flat('#0d9488', '#ffffff')],
  ['08-orange', 'Плоский · оранжевый', flat('#f97316', '#ffffff')],
  ['09-red', 'Плоский · красный', flat('#dc2626', '#ffffff')],
  ['10-yellow', 'Плоский · жёлтый', flat('#facc15', '#111111')],
  ['11-lime', 'Плоский · лайм на графите', flat('#18181b', '#a3e635')],
  ['12-sand', 'Плоский · графит на песке', flat('#f5ecd9', '#27272a')],
  // Объёмные
  ['13-ext-blue', 'Объём · выдавленный, синий', extruded('#3b82f6', '#ffffff', '#1e3a8a')],
  ['14-ext-black', 'Объём · выдавленный, чёрный', extruded('#0a0a0a', '#ffffff', '#52525b')],
  ['15-ext-coral', 'Объём · выдавленный, коралл', extruded('#fb7185', '#fff7ed', '#9f1239')],
  ['16-long-teal', 'Объём · длинная тень, бирюза', longShadow('#14b8a6', '#ffffff', '#0f766e')],
  ['17-long-violet', 'Объём · длинная тень, фиолет', longShadow('#8b5cf6', '#ffffff', '#6d28d9')],
  ['18-gloss-indigo', 'Объём · глянец, индиго', glossy(['#818cf8', '#3730a3'], ['#ffffff', '#c7d2fe'], '#1e1b4b')],
  ['19-gloss-dark', 'Объём · глянец, графит', glossy(['#4b5563', '#030712'], ['#ffffff', '#9ca3af'], '#000000')],
  ['20-gloss-sunset', 'Объём · глянец, закат', glossy(['#fbbf24', '#db2777'], ['#ffffff', '#fde68a'], '#7c2d12')],
  ['21-gloss-ocean', 'Объём · глянец, океан', glossy(['#22d3ee', '#1d4ed8'], ['#ffffff', '#cffafe'], '#172554')],
  ['22-neon', 'Неон · градиент на чёрном', neon('#09090b', '#22d3ee', '#a855f7', '#8b5cf6')],
  ['23-neon-warm', 'Неон · тёплый на чёрном', neon('#09090b', '#facc15', '#f43f5e', '#fb7185')],
  ['24-soft', 'Объём · мягкий, светлый', soft('#e4e4e7', '#e4e4e7', '#ffffff', '#a1a1aa')],
];

mkdirSync(join(OUT, 'a1'), { recursive: true });
for (const [id, , s] of variants) {
  writeFileSync(join(OUT, 'a1', `${id}.svg`), s);
  writeFileSync(join(OUT, 'a1', `${id}.png`), new Resvg(s, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
}

// Сводный лист: крупно 150 px, рядом 32 и 16 px.
const COLS = 4;
const CW = 300;
const CH = 210;
const SW = COLS * CW + 40;
const SH = Math.ceil(variants.length / COLS) * CH + 80;
const scoped = (s, n) => s.replace(/id="(\w+)"/g, `id="$1${n}"`).replace(/url\(#(\w+)\)/g, `url(#$1${n})`);
const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
let cells = '';
variants.forEach(([id, label, s], i) => {
  const x = 20 + (i % COLS) * CW;
  const y = 70 + Math.floor(i / COLS) * CH;
  const body = inner(scoped(s, `_${i}`));
  const place = (px, py, size) => `<svg x="${px}" y="${py}" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`;
  cells +=
    place(x + 10, y, 150) +
    place(x + 180, y + 40, 32) +
    place(x + 226, y + 48, 16) +
    `<text x="${x + 10}" y="${y + 176}" font-family="sans-serif" font-size="15" fill="#111">${label}</text>` +
    `<text x="${x + 10}" y="${y + 194}" font-family="monospace" font-size="12" fill="#777">${id}</text>`;
});
writeFileSync(
  join(OUT, 'a1-sheet.png'),
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" fill="#f4f4f5"/>` +
      `<text x="30" y="44" font-family="sans-serif" font-size="24" font-weight="700" fill="#111">microdocs — «#» a1 в цвете</text>${cells}</svg>`,
    { font: { loadSystemFonts: true } },
  ).render().asPng(),
);
console.log(`${variants.length} вариантов → ${join(OUT, 'a1')}`);
