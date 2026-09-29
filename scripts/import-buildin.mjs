#!/usr/bin/env node
/**
 * Перенос пространства Buildin в формат microdocs. Выгрузки в файлы у Buildin
 * нет, поэтому всё забирается через открытый API v2.
 *
 *   node scripts/import-buildin.mjs <куда-сложить>
 *
 * Токен внутренней интеграции — из BUILDIN_TOKEN или из файла .secrets/buildin-token.
 * Нужны права pages.read, blocks.read, databases.read. Интеграцию, выданную
 * на отдельные страницы, надо подключить к корневым страницам — иначе API пуст.
 *
 * На выходе та же раскладка, что у import-notion.mjs: tree.json, pages/<id>.md
 * и assets/…, плюс report.json с тем, что перенеслось не целиком.
 *
 * Что делает с содержимым:
 *   - идентификаторы страниц берёт из Buildin как есть: повторный прогон
 *     попадает в те же страницы, ссылки переписываются без таблицы соответствия;
 *   - порядок детей — как в боковой панели Buildin, строк базы — как в её первом виде;
 *   - убирает первую строку «# Заголовок» — заголовок хранится отдельно (FR-2);
 *   - ссылки на страницы Buildin переписывает в `microdocs:page/<id>`;
 *   - файлы из хранилища Buildin скачивает сразу (ссылки на них временные)
 *     и переписывает в `microdocs:asset/<путь>`;
 *   - базу превращает в страницу со списком строк, строку — в страницу
 *     со свойствами сверху; майнд-карту — во вложенный список.
 *
 * Ответы API кешируются в <выход>/.cache: после правки преобразований повторный
 * прогон в сеть за уже полученным не ходит. BUILDIN_NO_CACHE=1 — забрать заново.
 *
 * Чего обход не увидит: если пространство когда-то импортировано в Buildin из
 * Notion, базы там стали таблицами с пустой колонкой названий, а их записи —
 * страницами вне дерева. Поиск (/v2/search) их находит, боковая панель — нет.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const [, , OUT] = process.argv;
if (!OUT) {
  console.error('Использование: import-buildin.mjs <выход>');
  process.exit(1);
}

const TOKEN_FILE = '.secrets/buildin-token';
const TOKEN =
  process.env.BUILDIN_TOKEN?.trim() ||
  (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '');
if (!TOKEN) {
  console.error(`Нет токена: задайте BUILDIN_TOKEN или положите его в ${TOKEN_FILE}`);
  process.exit(1);
}

const API = 'https://api.buildin.ai/v2';
const CACHE = process.env.BUILDIN_NO_CACHE === '1' ? null : join(OUT, '.cache');
const CONCURRENCY = 4;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Адрес markdown-ссылки, с одним уровнем вложенных скобок — как в import-notion. */
const LINK_RE = /\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g;

// --- API ------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, body, path) {
    super(`${status} ${body?.code ?? ''} ${body?.message ?? ''} — ${path}`.replace(/\s+/g, ' '));
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

/**
 * Одновременных запросов не больше CONCURRENCY — на всё сразу. Обход дерева
 * рекурсивный, и пул на каждом уровне перемножал бы параллельность.
 */
let active = 0;
const waiters = [];
async function limited(fn) {
  if (active < CONCURRENCY) active++;
  else await new Promise((resolve) => waiters.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

/** Запрос к API с повтором на 429 и 5xx. GET и query кешируются на диск. */
async function api(path, { method = 'GET', body, fresh = false } = {}) {
  const key = createHash('sha1').update(`${method} ${path} ${JSON.stringify(body ?? null)}`).digest('hex');
  const cached = CACHE && join(CACHE, `${key}.json`);
  if (cached && !fresh && existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));

  for (let attempt = 0; ; attempt++) {
    requests++;
    let res;
    try {
      res = await limited(() =>
        fetch(API + path, {
          method,
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, json, path);
    if (cached) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cached, JSON.stringify(json), 'utf8');
    }
    return json;
  }
}

/** Все страницы списочного ответа. `request(cursor)` возвращает очередную. */
async function listAll(request) {
  const all = [];
  let cursor = null;
  do {
    const page = await request(cursor);
    all.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return all;
}

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

/** Прямые дети в порядке боковой панели. Колонки прозрачны — API поднимает их детей. */
const listChildren = (parentId) =>
  listAll((cursor) => api(`/pages?${qs({ parent_id: parentId, page_size: 100, start_cursor: cursor })}`));

/** Верх пространства: общие разделы, затем доступные мне, затем личные. */
async function listRoots() {
  let dir;
  try {
    dir = await api('/workspace/pages?page_size=100');
  } catch (error) {
    // Токен на отдельные страницы не видит боковой панели — остаётся старый корень.
    if (error.status !== 403) throw error;
    const legacy = await listAll((cursor) => api(`/pages?${qs({ page_size: 100, start_cursor: cursor })}`));
    if (legacy.length) return legacy;
    console.error('Боковой панели не видно, корни ищу поиском');
    return rootsFromSearch();
  }
  const roots = [];
  for (const section of ['team', 'shared', 'private']) {
    const first = dir[section] ?? { results: [] };
    roots.push(...first.results);
    if (first.has_more) {
      const rest = await listAll((cursor) =>
        api(`/workspace/pages/${section}?${qs({ page_size: 100, start_cursor: cursor ?? first.next_cursor })}`),
      );
      roots.push(...rest);
    }
  }
  return roots;
}

/**
 * Корни для токена, подключённого к отдельным страницам: всё видимое, у чего
 * родитель не виден. Страницы в колонках числятся детьми блока, а не страницы, —
 * их ставим в конец: к тому времени настоящий родитель их уже заберёт.
 */
async function rootsFromSearch() {
  const found = await listAll((cursor) =>
    api('/search', { method: 'POST', body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } }),
  );
  const visible = new Set(found.map((f) => f.id));
  const parentOf = (f) => f.parent?.page_id ?? f.parent?.database_id ?? null;
  const asNode = (f) => ({
    id: f.id,
    title: f.object === 'database' ? plain(f.title) : plain(f.properties?.title?.title),
    page_type: f.object === 'database' ? 'database' : f.page_type,
    has_children: true,
  });
  const live = found.filter((f) => !f.in_trash);
  const top = live.filter((f) => f.parent?.type !== 'block_id' && !visible.has(parentOf(f)));
  const inBlocks = live.filter((f) => f.parent?.type === 'block_id');
  return [...top, ...inBlocks].map(asNode);
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

// --- обход дерева ---------------------------------------------------------

/** id → { id, title, type, children, body?, props?, dbColumns?, out? } */
const pages = new Map();
const problems = [];

const plain = (richText = []) => richText.map((t) => t.plain_text ?? '').join('');

/**
 * Импорт в Buildin из Notion оставил в начале части заголовков огрызки эмодзи-иконок:
 * одинокий U+FE0F или U+200D от составного эмодзи. Сами эмодзи не трогаем.
 */
const cleanTitle = (title) => (title ?? '').replace(/^[\p{Mn}\p{Cf}\s]+/u, '').trim();

/** Для сравнения заголовков: только буквы и цифры, без иконок и регистра. */
const bare = (text) => text.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

function addPage(id, title, type, extra = {}) {
  const page = { id, title: cleanTitle(title) || 'Без названия', type, children: [], ...extra };
  pages.set(id, page);
  return page;
}

let visited = 0;
function tick() {
  visited++;
  if (visited % 25 === 0) console.error(`… обойдено ${visited}, запросов ${requests}`);
}

/** Узел боковой панели и всё, что под ним. Повторы (избранное, ссылки) пропускаются. */
async function visit(node) {
  if (pages.has(node.id)) return null;
  const page = addPage(node.id, node.title, node.page_type);
  tick();

  if (node.page_type === 'database') {
    await visitDatabase(page);
  } else if (node.page_type === 'mind_map') {
    await loadMindMap(page);
  } else if (node.page_type === 'page') {
    await loadBody(page);
  }

  if (node.has_children) await visitChildren(page);
  return page;
}

async function visitChildren(page) {
  let nodes;
  try {
    nodes = await listChildren(page.id);
  } catch (error) {
    problems.push({ page: page.id, title: page.title, what: 'дети', error: error.message });
    return;
  }
  // Порядок сохраняем, а тянем параллельно: сколько одновременно, решает limited.
  const children = await Promise.all(nodes.map(visit));
  page.children.push(...children.filter(Boolean));
}

async function loadBody(page, { fresh = false } = {}) {
  try {
    const md = await api(`/pages/${page.id}/content/markdown`, { fresh });
    page.body = md.markdown ?? '';
  } catch (error) {
    page.body = '';
    problems.push({ page: page.id, title: page.title, what: 'текст', error: error.message });
  }
}

async function loadMindMap(page) {
  try {
    const map = await api(`/mind-maps/${page.id}`);
    const lines = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        lines.push(`${'  '.repeat(depth)}- ${plain(n.rich_text) || ' '}`);
        walk(n.children ?? [], depth + 1);
      }
    };
    walk(map.nodes ?? [], 0);
    page.body = lines.join('\n');
  } catch (error) {
    page.body = '';
    problems.push({ page: page.id, title: page.title, what: 'майнд-карта', error: error.message });
  }
}

/** Строки базы: все, но в порядке первого вида, если он есть. */
async function visitDatabase(page) {
  let rows, schema;
  try {
    schema = await api(`/databases/${page.id}`);
    rows = await listAll((cursor) =>
      api(`/databases/${page.id}/query`, {
        method: 'POST',
        body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
      }),
    );
  } catch (error) {
    page.body = '';
    problems.push({ page: page.id, title: page.title, what: 'база', error: error.message });
    return;
  }
  rows = rows.filter((r) => !r.in_trash);

  try {
    const views = await listAll((cursor) =>
      api(`/databases/${page.id}/views?${qs({ page_size: 100, start_cursor: cursor })}`),
    );
    if (views[0]) {
      // Вид может фильтровать — берём из него только порядок, не состав.
      const ordered = await listAll((cursor) =>
        api(`/databases/${page.id}/query`, {
          method: 'POST',
          body: { view_id: views[0].id, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
        }),
      );
      const rank = new Map(ordered.map((r, i) => [r.id, i]));
      rows.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    }
  } catch {
    // Без вида — в порядке ответа, это не повод терять базу.
  }

  const columns = Object.entries(schema.properties ?? {});
  const titleKey = columns.find(([, p]) => p.type === 'title')?.[0];
  page.dbColumns = columns.map(([name]) => name).filter((n) => n !== titleKey);

  const children = await Promise.all(
    rows.map(async (row) => {
      if (pages.has(row.id)) return null;
      const title = titleKey ? plain(row.properties?.[titleKey]?.title) : '';
      const child = addPage(row.id, title, 'row', { props: rowProps(row, titleKey) });
      tick();
      await loadBody(child);
      // У строки могут быть свои подстраницы; признака has_children в строке нет.
      await visitChildren(child);
      return child;
    }),
  );
  page.children.push(...children.filter(Boolean));
}

// --- свойства строк базы --------------------------------------------------

function dateText(d) {
  if (!d) return '';
  return d.end ? `${d.start} → ${d.end}` : d.start;
}

function propText(p) {
  switch (p?.type) {
    case 'title':
    case 'rich_text':
      return plain(p[p.type]);
    case 'number':
      return p.number == null ? '' : String(p.number);
    case 'select':
    case 'status':
      return p[p.type]?.name ?? '';
    case 'multi_select':
      return p.multi_select.map((o) => o.name).join(', ');
    case 'date':
      return dateText(p.date);
    case 'checkbox':
      return p.checkbox ? '✓' : '✗';
    case 'url':
    case 'email':
    case 'phone_number':
      return p[p.type] ?? '';
    case 'people':
      return p.people.map((u) => u.name ?? u.id).join(', ');
    case 'files':
      return p.files.map((f) => `[${f.name}](${f.file?.url ?? f.external?.url})`).join(', ');
    case 'relation':
      return (p.relation ?? []).map((r) => `[↗](https://buildin.ai/${r.id})`).join(' ');
    case 'formula': {
      const f = p.formula ?? {};
      return f.type === 'date' ? dateText(f.date) : String(f[f.type] ?? '');
    }
    case 'rollup': {
      const r = p.rollup ?? {};
      if (r.type === 'array') return (r.array ?? []).map(propText).filter(Boolean).join(', ');
      return r.type === 'date' ? dateText(r.date) : String(r[r.type] ?? '');
    }
    case 'created_time':
    case 'last_edited_time':
      return p[p.type] ?? '';
    case 'created_by':
    case 'last_edited_by':
      return p[p.type]?.name ?? '';
    default:
      return p ? JSON.stringify(p[p.type] ?? '') : '';
  }
}

function rowProps(row, titleKey) {
  return Object.entries(row.properties ?? {})
    .filter(([name]) => name !== titleKey)
    .map(([name, p]) => [name, propText(p)])
    .filter(([, v]) => v !== '');
}

// --- текст страниц --------------------------------------------------------

const stats = { pageLinks: 0, fileLinks: 0, fileErrors: 0, unsupported: {} };

const PAGE_URL = new RegExp(`^https?://(?:www\\.)?buildin\\.ai/(?:[^?#]*/)?(${UUID})(?:[?#].*)?$`, 'i');

/** Ссылка на страницу этого пространства — её id, иначе null. */
function pageTarget(url) {
  const id = PAGE_URL.exec(url)?.[1]?.toLowerCase();
  return id && pages.has(id) ? id : null;
}

/**
 * Файл из хранилища Buildin: подписанная временная ссылка, скачать надо сейчас.
 * Сам buildin.ai — это страницы, файлы лежат на поддоменах и в объектных хранилищах.
 */
function isHostedFile(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const signed = [...u.searchParams.keys()].some((k) =>
    /^(x-amz-|x-oss-|x-tos-|signature$|expires$|ossaccesskeyid$|auth_key$)/i.test(k),
  );
  const ownHost = /(^|\.)(buildin|flowus)\./i.test(u.hostname) && !/^(www\.)?buildin\.ai$/i.test(u.hostname);
  return signed || ownHost;
}

function safeName(name) {
  return name.replace(/[\s/\\?%*:|"<>#]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
}

/**
 * Ключ — от адреса без подписи: одинаковый между прогонами и без коллизий,
 * хотя у Buildin почти все вставленные картинки зовутся image.png.
 */
async function download(url) {
  const u = new URL(url);
  const stable = u.origin + u.pathname;
  let name;
  try {
    name = decodeURIComponent(u.pathname.split('/').pop() || '');
  } catch {
    name = u.pathname.split('/').pop() || '';
  }
  const key = `buildin/${createHash('sha1').update(stable).digest('hex').slice(0, 12)}/${safeName(name)}`;
  const dest = join(OUT, 'assets', key);
  if (existsSync(dest)) return key;

  const res = await limited(() => fetch(url));
  if (!res.ok) throw new Error(`${res.status} при скачивании ${stable}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return key;
}

/** Адрес из `](...)`: без <угловых скобок> и без "заголовка". */
const cleanHref = (raw) => raw.trim().replace(/^<(.*)>$/, '$1').replace(/\s+"[^"]*"$/, '');

function markdownOf(page) {
  if (page.type === 'database') {
    const rows = page.children.filter((c) => c.type === 'row');
    if (!rows.length) return '_База Buildin, пустая._';
    const list = rows.map((r) => {
      const extra = page.dbColumns
        .map((col) => r.props.find(([k]) => k === col))
        .filter(Boolean)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      return `- [${r.title.replace(/[[\]]/g, '\\$&')}](microdocs:page/${r.id})${extra ? ` — ${extra}` : ''}`;
    });
    return `_База Buildin, строк: ${rows.length}._\n\n${list.join('\n')}`;
  }

  // Перед заголовком бывает строка из одного огрызка иконки — её тоже прочь.
  let md = (page.body ?? '').replace(/^(?:[\p{Mn}\p{Cf}\s]*\n)+/u, '');
  // Заголовок хранится отдельным полем (FR-2). Снимаем, только если это он и есть:
  // первый блок страницы вполне может быть своим заголовком первого уровня.
  const [first, ...rest] = md.split('\n');
  if (first?.startsWith('# ') && bare(first.slice(2)) === bare(page.title)) md = rest.join('\n');
  md = md.replace(/^\n+/, '').trimEnd();

  if (page.type === 'row' && page.props.length) {
    const head = page.props.map(([k, v]) => `- **${k}:** ${v}`).join('\n');
    md = md ? `${head}\n\n---\n\n${md}` : head;
  }
  return md;
}

async function transform(page, { retry = true } = {}) {
  let md = markdownOf(page);

  // Файлы качаем, пока подписи живы. Протухли (текст из кеша) — берём текст заново, один раз.
  const files = [...new Set([...md.matchAll(LINK_RE)].map((m) => cleanHref(m[1])))].filter(
    (h) => !pageTarget(h) && isHostedFile(h),
  );
  const keys = new Map();
  for (const url of files) {
    try {
      keys.set(url, await download(url));
    } catch (error) {
      if (retry && CACHE && (page.type === 'page' || page.type === 'row')) {
        await loadBody(page, { fresh: true });
        return transform(page, { retry: false });
      }
      stats.fileErrors++;
      problems.push({ page: page.id, title: page.title, what: 'файл', error: error.message });
    }
  }

  md = md.replace(LINK_RE, (whole, raw) => {
    const href = cleanHref(raw);
    const target = pageTarget(href);
    if (target) {
      stats.pageLinks++;
      return `](microdocs:page/${target})`;
    }
    if (keys.has(href)) {
      stats.fileLinks++;
      return `](microdocs:asset/${keys.get(href)})`;
    }
    return whole;
  });

  // Блоки, которых Markdown-выгрузка не умеет, приходят HTML-комментариями.
  for (const m of md.matchAll(/<!--\s*([^\s>]+)[^]*?-->/g)) {
    stats.unsupported[m[1]] = (stats.unsupported[m[1]] ?? 0) + 1;
  }

  page.out = md;
}

// --- запуск ----------------------------------------------------------------

const me = await api('/users/me', { fresh: true });
const scopes = Object.entries(me.capabilities ?? {})
  .filter(([, v]) => v)
  .map(([k]) => k);
console.error(`Токен: ${me.name} в «${me.workspace_name}», права: ${scopes.join(', ')}`);

const rootNodes = (await listRoots()).filter((n) => !n.in_trash);
console.error(`Корневых узлов: ${rootNodes.length}`);

const roots = [];
for (const node of rootNodes) {
  const page = await visit(node);
  if (page) roots.push(page);
}

console.error(`Обход закончен: ${pages.size} страниц, ${requests} запросов. Переписываю текст…`);

await pool([...pages.values()], CONCURRENCY, (page) => transform(page));

rmSync(join(OUT, 'pages'), { recursive: true, force: true });
mkdirSync(join(OUT, 'pages'), { recursive: true });
for (const page of pages.values()) {
  writeFileSync(join(OUT, 'pages', `${page.id}.md`), page.out + '\n', 'utf8');
}

const toNode = (p) => ({ id: p.id, title: p.title, children: p.children.map(toNode) });
writeFileSync(join(OUT, 'tree.json'), JSON.stringify({ roots: roots.map(toNode) }, null, 2), 'utf8');

const leftovers = [...pages.values()].filter((p) => /https?:\/\/(?:[\w-]+\.)*buildin\.ai\//i.test(p.out));
const byType = {};
for (const p of pages.values()) byType[p.type] = (byType[p.type] ?? 0) + 1;

const report = {
  workspace: me.workspace_name,
  pages: pages.size,
  byType,
  roots: roots.map((r) => r.title),
  pageLinks: stats.pageLinks,
  fileLinks: stats.fileLinks,
  fileErrors: stats.fileErrors,
  unsupportedBlocks: stats.unsupported,
  pagesWithBuildinLinksLeft: leftovers.map((p) => ({ id: p.id, title: p.title })),
  problems,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`страниц: ${pages.size} (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log(`корневых: ${roots.length}`);
console.log(`ссылок на страницы переписано: ${stats.pageLinks}`);
console.log(`ссылок на файлы переписано: ${stats.fileLinks}, не скачалось: ${stats.fileErrors}`);
console.log(`неподдержанных блоков: ${Object.values(stats.unsupported).reduce((a, b) => a + b, 0)}`);
console.log(`страниц с оставшимися ссылками на buildin.ai: ${leftovers.length}`);
console.log(`проблем: ${problems.length} (подробности в report.json)`);
