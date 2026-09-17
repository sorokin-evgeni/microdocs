#!/usr/bin/env node
/**
 * Перенос экспорта Notion (Markdown & CSV) в формат microdocs.
 *
 *   node scripts/import-notion.mjs <распакованный-экспорт> <куда-сложить>
 *
 * На выходе: tree.json, pages/<id>.md и assets/… — ровно та раскладка,
 * что уезжает в бакет.
 *
 * Что делает с содержимым:
 *   - отрезает служебный идентификатор Notion от имени страницы;
 *   - убирает первую строку «# Заголовок» — заголовок хранится отдельно (FR-2);
 *   - переписывает ссылки между страницами в `microdocs:page/<id>`;
 *   - переписывает вложения в `microdocs:asset/<путь>` и складывает файлы рядом;
 *   - порядок дочерних страниц берёт из порядка ссылок в родителе.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname, posix } from 'node:path';
import { randomUUID } from 'node:crypto';

const [, , SRC, OUT] = process.argv;
if (!SRC || !OUT) {
  console.error('Использование: import-notion.mjs <экспорт> <выход>');
  process.exit(1);
}

const NOTION_ID = /^(?<name>.+?) (?<id>[0-9a-f]{32})$/;

/**
 * Адрес markdown-ссылки. Notion не экранирует скобки в именах файлов
 * («Иванов Иван (1) <id>.md»), поэтому допускаем один уровень вложенных.
 */
const LINK_RE = /\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g;

/** Все файлы экспорта, рекурсивно. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC);
const mdFiles = files.filter((f) => extname(f) === '.md');
const assetFiles = files.filter((f) => extname(f) !== '.md');

// --- страницы -------------------------------------------------------------

/** Путь файла → страница. Дети лежат в одноимённой папке без расширения. */
const byPath = new Map();
for (const file of mdFiles) {
  const stem = basename(file, '.md');
  const m = NOTION_ID.exec(stem);
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const title = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : (m?.groups.name ?? stem);
  // Первая строка — заголовок, он хранится отдельным полем.
  const body = (lines[0]?.startsWith('# ') ? lines.slice(1) : lines).join('\n').replace(/^\n+/, '').trimEnd();

  byPath.set(file, {
    id: randomUUID(),
    title,
    body,
    dir: file.slice(0, -3), // папка с детьми, если есть
    children: [],
  });
}

/**
 * Базы Notion выгружаются каталогом строк без страницы-обёртки. Без неё все
 * строки всплыли бы в корень, поэтому обёртку создаём сами.
 */
const pageDirs = new Set([...byPath.values()].map((p) => p.dir));
const dirsWithPages = new Set(mdFiles.map((f) => dirname(f)));

for (const dir of dirsWithPages) {
  if (dir === SRC || pageDirs.has(dir)) continue;
  const m = NOTION_ID.exec(basename(dir));
  const title = m?.groups.name ?? basename(dir);
  // Табличный вид базы лежит рядом в CSV — сошлёмся на него, чтобы не потерять.
  const csv = [`${dir}.csv`, `${dir}_all.csv`].find((f) => assetFiles.includes(f));
  byPath.set(`${dir}.md`, {
    id: randomUUID(),
    title,
    body: csv
      ? `_База Notion. Табличный вид: [${basename(csv)}](${encodeURI(basename(csv))})_`
      : '_База Notion._',
    dir,
    children: [],
    synthetic: true,
  });
  pageDirs.add(dir);
}

// Родитель определяется каталогом: страница лежит внутри папки родителя.
const dirToPage = new Map();
for (const page of byPath.values()) dirToPage.set(page.dir, page);

const roots = [];
for (const [file, page] of byPath) {
  const parent = dirToPage.get(dirname(file));
  if (parent) parent.children.push(page);
  else roots.push(page);
}

// --- порядок детей по ссылкам в родителе ----------------------------------

const pathToPage = byPath;

/** Разрешает относительную ссылку из файла в страницу экспорта. */
function resolveLink(fromFile, href) {
  let decoded;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    return null;
  }
  const target = join(dirname(fromFile), decoded);
  return pathToPage.get(target) ?? null;
}

for (const [file, page] of byPath) {
  if (page.children.length < 2) continue;
  const order = [];
  for (const m of page.body.matchAll(LINK_RE)) {
    if (!m[1].endsWith('.md')) continue;
    const target = resolveLink(file, m[1]);
    if (target && page.children.includes(target) && !order.includes(target)) order.push(target);
  }
  const rest = page.children.filter((c) => !order.includes(c));
  rest.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  page.children = [...order, ...rest];
}

// --- вложения --------------------------------------------------------------

const assetKey = new Map();
for (const file of assetFiles) {
  const rel = relative(SRC, file).split('/').map((s) => s.replace(/\s+/g, '_')).join('/');
  assetKey.set(file, rel);
}

// --- переписывание ссылок --------------------------------------------------

let pageLinks = 0, assetLinks = 0, deadLinks = 0;

for (const [file, page] of byPath) {
  page.body = page.body.replace(LINK_RE, (whole, href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return whole; // внешняя ссылка
    const target = resolveLink(file, href);
    if (target) {
      pageLinks++;
      return `](microdocs:page/${target.id})`;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      decoded = href;
    }
    const asAsset = join(dirname(file), decoded);
    if (assetKey.has(asAsset)) {
      assetLinks++;
      return `](microdocs:asset/${assetKey.get(asAsset)})`;
    }
    deadLinks++;
    return whole;
  });
}

// --- вывод -----------------------------------------------------------------

const lift = process.env.LIFT_ROOT !== '0';
let topLevel = roots;
if (lift && roots.length === 1 && roots[0].children.length) {
  topLevel = roots[0].children;
}

mkdirSync(join(OUT, 'pages'), { recursive: true });

// Пишем только достижимые из дерева: поднятый Root в него не входит.
const reachable = [];
(function collect(nodes) {
  for (const n of nodes) {
    reachable.push(n);
    collect(n.children);
  }
})(topLevel);

for (const page of reachable) {
  writeFileSync(join(OUT, 'pages', `${page.id}.md`), page.body + '\n', 'utf8');
}

for (const [file, key] of assetKey) {
  const dest = join(OUT, 'assets', key);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
}

const toNode = (p) => ({ id: p.id, title: p.title, children: p.children.map(toNode) });
writeFileSync(
  join(OUT, 'tree.json'),
  JSON.stringify({ roots: topLevel.map(toNode) }, null, 2),
  'utf8',
);

const total = byPath.size;
const written = lift && topLevel !== roots ? total - 1 : total;
console.log(`страниц разобрано: ${total}`);
console.log(`корневых после подъёма: ${topLevel.length}`);
console.log(`ссылок на страницы переписано: ${pageLinks}`);
console.log(`ссылок на вложения переписано: ${assetLinks}`);
console.log(`неразрешённых ссылок осталось: ${deadLinks}`);
console.log(`вложений скопировано: ${assetKey.size}`);
