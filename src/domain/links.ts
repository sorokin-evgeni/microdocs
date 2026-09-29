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

export type LinkTarget =
  | { kind: 'page'; id: PageId }
  | { kind: 'asset'; path: string }
  | { kind: 'external'; href: string };

export function parseLink(href: string): LinkTarget {
  if (href.startsWith(PAGE_PREFIX)) return { kind: 'page', id: href.slice(PAGE_PREFIX.length) };
  if (href.startsWith(ASSET_PREFIX)) return { kind: 'asset', path: href.slice(ASSET_PREFIX.length) };
  return { kind: 'external', href };
}
