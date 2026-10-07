import { useEffect } from 'react';
import type { PageId, Tree } from '../types';
import { findNode } from '../domain/tree';
import { pageIdFromPath, pagePath } from '../domain/pageUrl';

/** Страница из адреса; если адрес никуда не ведёт — первая в базе. */
export function pageFromLocation(tree: Tree): PageId | null {
  return pageIdFromPath(tree, window.location.pathname) ?? tree.roots[0]?.id ?? null;
}

const LAST_PAGE = 'microdocs:last-page';

/**
 * Страница при запуске. Ссылка на страницу открывает её; голый адрес — запуск
 * с экрана Домой, из приложения или по закладке на сайт — ту, что была открыта
 * последней на этом устройстве, а не первую в базе. Последняя могла пропасть
 * (удалили, в том числе на другом устройстве) — тогда первая.
 */
export function initialPage(tree: Tree): PageId | null {
  const fromPath = pageIdFromPath(tree, window.location.pathname);
  if (fromPath) return fromPath;
  const last = readLastPage();
  if (last && findNode(tree, last)) return last;
  return tree.roots[0]?.id ?? null;
}

function readLastPage(): PageId | null {
  try {
    return localStorage.getItem(LAST_PAGE);
  } catch {
    return null;
  }
}

function rememberLastPage(id: PageId) {
  try {
    localStorage.setItem(LAST_PAGE, id);
  } catch {
    // Без хранилища просто откроется первая страница.
  }
}

/**
 * Держит открытую страницу в адресе: после перезагрузки открывается она же,
 * «Назад» и «Вперёд» браузера переключают страницы.
 */
export function usePageUrl(
  tree: Tree | null,
  selectedId: PageId | null,
  select: (id: PageId | null) => void,
) {
  useEffect(() => {
    if (!tree) return;
    const onPopState = () => select(pageFromLocation(tree));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [tree, select]);

  useEffect(() => {
    if (selectedId) rememberLastPage(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!tree) return;
    const node = selectedId ? findNode(tree, selectedId) : null;
    const target = node ? pagePath(node) : '/';
    if (window.location.pathname === target) return;
    const currentId = pageIdFromPath(tree, window.location.pathname);

    // Переход на другую страницу — новая запись в истории.
    if (node && currentId && currentId !== node.id) {
      window.history.pushState(null, '', target);
      return;
    }

    // Та же страница под новым названием или адрес, который никуда не ведёт
    // (корень, удалённая страница), — правим на месте. С задержкой, потому что
    // заголовок меняется на каждое нажатие, а Safari ограничивает частоту
    // replaceState и бросает исключение.
    const timer = setTimeout(() => window.history.replaceState(null, '', target), 300);
    return () => clearTimeout(timer);
  }, [tree, selectedId]);
}
