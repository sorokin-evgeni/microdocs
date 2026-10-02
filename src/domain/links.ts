import type { PageId } from '../types';

/**
 * Внутренние ссылки в тексте страниц. Их пишут импорты (scripts/import-*.mjs):
 *
 *   microdocs:page/<id>     — на другую страницу базы;
 *   microdocs:asset/<путь>  — на вложение в бакете.
 */
export const LINK_SCHEME = 'microdocs';

const PAGE_PREFIX = `${LINK_SCHEME}:page/`;
const ASSET_PREFIX = `${LINK_SCHEME}:asset/`;
const ASSET_URL_PREFIX = '/api/assets/';

export type LinkTarget =
  | { kind: 'page'; id: PageId }
  | { kind: 'asset'; path: string }
  | { kind: 'external'; href: string };

export function parseLink(href: string): LinkTarget {
  if (href.startsWith(PAGE_PREFIX)) return { kind: 'page', id: href.slice(PAGE_PREFIX.length) };
  if (href.startsWith(ASSET_PREFIX)) return { kind: 'asset', path: decodePath(href.slice(ASSET_PREFIX.length)) };
  return { kind: 'external', href };
}

/** Страницы, на которые ссылается текст, по порядку и без повторов. */
export function linkedPageIds(markdown: string): PageId[] {
  const ids = new Set<PageId>();
  for (const match of markdown.matchAll(/microdocs:page\/([A-Za-z0-9._-]+)/g)) ids.add(match[1]!);
  return [...ids];
}

/** Адрес, по которому сервер отдаёт вложение. */
export function assetUrl(path: string): string {
  return ASSET_URL_PREFIX + path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Обратное к assetUrl: адрес сервера → ссылка на вложение, как её хранит текст.
 * Нужно, когда картинка приходит из буфера обмена уже с адресом сервера.
 */
export function assetLinkFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return null;
  }
  // Только свой сервер: чужой /api/assets/… — просто картинка из интернета.
  if (parsed.origin !== window.location.origin) return null;
  if (!parsed.pathname.startsWith(ASSET_URL_PREFIX)) return null;
  return ASSET_PREFIX + decodePath(parsed.pathname.slice(ASSET_URL_PREFIX.length));
}

/**
 * Путь в тексте бывает и сырым (`Отчёт.pdf`), и закодированным: разбор Markdown
 * кодирует не-ASCII в адресах, и после правки страница сохраняется уже так.
 * Ключ в хранилище — сырой.
 */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
