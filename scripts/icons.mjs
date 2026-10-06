#!/usr/bin/env node
// Все иконки microdocs из одного знака: наклонная решётка «#» — заголовок
// markdown, — чёрная на белой плитке.
//
//   node scripts/icons.mjs
//
// Пишет:
//   src/logo.svg                    вкладка браузера и шапка: плитка со скруглением
//   public/icons/*.png              iPhone и манифест: квадрат без прозрачности,
//                                   углы скругляет система
//   desktop/build/icon.png          Mac: плитка по шаблону Apple, поля прозрачные
//   android/.../ic_launcher_*.xml   Android: знак и фон адаптивной иконки
//
// Варианты, из которых выбран этот, — design/logo-hash (форма a1, цвет 02-white).
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const INK = '#0a0a0a';
const PAPER = '#ffffff';

/**
 * Знак на сетке 64×64: две вертикали с наклоном 18° и две горизонтали,
 * штрих 6 со скруглёнными концами. Каждый штрих — залитый контур «стадион»,
 * а не линия с обводкой: так один и тот же путь годится и для SVG, и для
 * векторной иконки Android.
 */
const STROKE = 6;
const SPAN = 17; // от центра до конца штриха по вертикали (горизонтали)
const GAP = 12; // между параллельными штрихами
const SLANT = Math.tan((18 * Math.PI) / 180);

/** Отрезок (x1,y1)–(x2,y2) толщиной STROKE с полукруглыми концами. */
function stadium(x1, y1, x2, y2) {
  const r = STROKE / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * r;
  const ny = ((x2 - x1) / len) * r;
  const f = (v) => +v.toFixed(2);
  return (
    `M${f(x1 + nx)} ${f(y1 + ny)}L${f(x2 + nx)} ${f(y2 + ny)}` +
    `A${r} ${r} 0 0 0 ${f(x2 - nx)} ${f(y2 - ny)}` +
    `L${f(x1 - nx)} ${f(y1 - ny)}A${r} ${r} 0 0 0 ${f(x1 + nx)} ${f(y1 + ny)}Z`
  );
}

const C = 32;
const GLYPH = [
  stadium(C - GAP / 2 + SPAN * SLANT, C - SPAN, C - GAP / 2 - SPAN * SLANT, C + SPAN),
  stadium(C + GAP / 2 + SPAN * SLANT, C - SPAN, C + GAP / 2 - SPAN * SLANT, C + SPAN),
  stadium(C - SPAN, C - GAP / 2, C + SPAN, C - GAP / 2),
  stadium(C - SPAN, C + GAP / 2, C + SPAN, C + GAP / 2),
].join('');

const glyph = (color) => `<path d="${GLYPH}" fill="${color}"/>`;

/** Плитка со скруглением, углы прозрачные. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="${PAPER}"/>
  ${glyph(INK)}
</svg>
`;

/** Квадрат во весь холст: форму задаёт система. */
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${PAPER}"/>
  ${glyph(INK)}
</svg>`;

/**
 * Mac: тело иконки 824 из 1024 со скруглением 185 — шаблон Apple для Big Sur
 * и новее, — остальное прозрачное, как у системных иконок.
 */
const mac = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="${PAPER}"/>
  <g transform="translate(100 100) scale(${824 / 64})">${glyph(INK)}</g>
</svg>`;

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync('src/logo.svg', rounded);
writeFileSync('public/icons/apple-touch-icon.png', png(square, 180));
writeFileSync('public/icons/icon-192.png', png(square, 192));
writeFileSync('public/icons/icon-512.png', png(square, 512));
writeFileSync('desktop/build/icon.png', png(mac, 1024));

// Android, адаптивная иконка: холст 108dp, система показывает круг или
// скруглённый квадрат диаметром около 72dp, гарантированно видно 66dp.
// Знак (~41×40 из 64) — 1,1: дальние концы штрихов в 26dp от центра, внутри безопасного круга 66dp.
const scale = 1.1;
const offset = (108 - 64 * scale) / 2;
const androidColor = (hex) => `#FF${hex.slice(1).toUpperCase()}`;

writeFileSync(
  'android/src/main/res/drawable/ic_launcher_foreground.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Создано scripts/icons.mjs — правьте там. Знак «#» в центре холста 108dp. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="${scale}"
        android:scaleY="${scale}"
        android:translateX="${offset.toFixed(2)}"
        android:translateY="${offset.toFixed(2)}">
        <path
            android:fillColor="${androidColor(INK)}"
            android:pathData="${GLYPH}" />
    </group>
</vector>
`,
);

writeFileSync(
  'android/src/main/res/drawable/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Создано scripts/icons.mjs — правьте там. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="${androidColor(PAPER)}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`,
);

console.log('Иконки обновлены.');
