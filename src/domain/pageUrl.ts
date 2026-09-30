import type { PageId, Tree, TreeNode } from '../types';
import { subtreeIds } from './tree';

/**
 * Адрес страницы: /p/<название латиницей>-<id>. Название — для человека,
 * страницу определяет только id, поэтому старые ссылки переживают переименование.
 */
const PREFIX = '/p/';
const SLUG_MAX = 60;

export function pagePath(node: TreeNode): string {
  const slug = slugify(node.title);
  return PREFIX + (slug ? `${slug}-${node.id}` : node.id);
}

/** Страница, на которую указывает адрес; null — если адрес не страницы или её нет в базе. */
export function pageIdFromPath(tree: Tree, pathname: string): PageId | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const segment = pathname.slice(PREFIX.length);
  // В id бывают дефисы (UUID), так что по последнему дефису не разрезать —
  // ищем страницу, id которой стоит в конце адреса.
  const ids = tree.roots.flatMap(subtreeIds);
  return ids.find((id) => segment === id || segment.endsWith(`-${id}`)) ?? null;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(title: string): string {
  return [...title.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
}
