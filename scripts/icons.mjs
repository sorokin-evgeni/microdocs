#!/usr/bin/env node
// Все иконки microdocs из одного знака: двойные квадратные скобки с наклоном —
// вики-ссылка [[…]], — белые на чёрной плитке.
//
//   node scripts/icons.mjs
//
// Пишет:
//   src/logo.svg                    вкладка браузера и шапка: плитка со скруглением
//   public/icons/*.png              iPhone и манифест: квадрат без прозрачности,
//                                   углы скругляет система
//   desktop/build/icon.png          Mac: плитка по шаблону Apple, поля прозрачные
//   android/.../ic_launcher_*.xml   Android: знак и фон адаптивной иконки
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const INK = '#0a0a0a';
const PAPER = '#ffffff';

/**
 * Знак на сетке 64×64: четыре скобки [[ ]] залитыми фигурами. Штрих 4, внутри
 * пары зазор 3 — на 16 px это ещё различимо, — между парами 6.
 * Наклон зашит прямо в координаты: векторные иконки Android наклон не умеют.
 */
const TOP = 16;
const BOTTOM = 48;
const BAR = 4; // толщина штриха
const WIDTH = 8; // ширина скобки с усиками
const SLANT = Math.tan((12 * Math.PI) / 180);

/** «[» или «]» с левым краем в x — контур по часовой стрелке. */
function bracket(x, open) {
  const pts = open
    ? [[x, TOP], [x + WIDTH, TOP], [x + WIDTH, TOP + BAR], [x + BAR, TOP + BAR],
       [x + BAR, BOTTOM - BAR], [x + WIDTH, BOTTOM - BAR], [x + WIDTH, BOTTOM], [x, BOTTOM]]
    : [[x, TOP], [x + WIDTH, TOP], [x + WIDTH, BOTTOM], [x, BOTTOM],
       [x, BOTTOM - BAR], [x + WIDTH - BAR, BOTTOM - BAR], [x + WIDTH - BAR, TOP + BAR], [x, TOP + BAR]];
  // Верх уходит вправо, низ влево — относительно середины по высоте.
  const skewed = pts.map(([px, py]) => [px + (32 - py) * SLANT, py]);
  return 'M' + skewed.map(([px, py]) => `${+px.toFixed(2)} ${py}`).join('L') + 'Z';
}

// 8 + 3 + 8 + 6 + 8 + 3 + 8 = 44 по ширине, с 10 до 54.
const GLYPH = [bracket(10, true), bracket(21, true), bracket(35, false), bracket(46, false)].join('');

const glyph = (color) => `<path d="${GLYPH}" fill="${color}"/>`;

/** Плитка со скруглением, углы прозрачные. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="${INK}"/>
  ${glyph(PAPER)}
</svg>
`;

/** Квадрат во весь холст: форму задаёт система. */
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${INK}"/>
  ${glyph(PAPER)}
</svg>`;

/**
 * Mac: тело иконки 824 из 1024 со скруглением 185 — шаблон Apple для Big Sur
 * и новее, — остальное прозрачное, как у системных иконок.
 */
const mac = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="${INK}"/>
  <g transform="translate(100 100) scale(${824 / 64})">${glyph(PAPER)}</g>
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
// Знак (~51×32 из 64 с наклоном) — 1,08: углы скобок в 32dp от центра, внутри безопасного круга 66dp.
const scale = 1.08;
const offset = (108 - 64 * scale) / 2;
const androidColor = (hex) => `#FF${hex.slice(1).toUpperCase()}`;

writeFileSync(
  'android/src/main/res/drawable/ic_launcher_foreground.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Создано scripts/icons.mjs — правьте там. Знак [[…]] в центре холста 108dp. -->
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
            android:fillColor="${androidColor(PAPER)}"
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
        android:fillColor="${androidColor(INK)}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`,
);

console.log('Иконки обновлены.');
