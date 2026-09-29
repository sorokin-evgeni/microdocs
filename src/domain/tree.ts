import type { PageId, Tree, TreeNode } from '../types';

/**
 * Операции над деревом страниц. Все функции чистые и возвращают новое дерево,
 * исходное не мутируют.
 */

export function newPageId(): PageId {
  return crypto.randomUUID();
}

export function makeNode(title: string, id: PageId = newPageId()): TreeNode {
  return { id, title, children: [] };
}

export function findNode(tree: Tree, id: PageId): TreeNode | null {
  return findIn(tree.roots, id);
}

/** Предки страницы от корня вниз, без неё самой. Нет такой страницы — пусто. */
export function ancestorIds(tree: Tree, id: PageId): PageId[] {
  const walk = (nodes: TreeNode[], path: PageId[]): PageId[] | null => {
    for (const node of nodes) {
      if (node.id === id) return path;
      const found = walk(node.children, [...path, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree.roots, []) ?? [];
}

/** Идентификаторы всего поддерева, включая его корень. */
export function subtreeIds(node: TreeNode): PageId[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

/** Добавляет узел последним ребёнком (FR-7: новая страница уходит в конец). */
export function insertNode(
  tree: Tree,
  parentId: PageId | null,
  node: TreeNode,
): Tree {
  if (parentId === null) {
    return { ...tree, roots: [...tree.roots, node] };
  }
  if (!findNode(tree, parentId)) {
    throw new Error(`Родительская страница ${parentId} не найдена`);
  }
  return { ...tree, roots: appendTo(tree.roots, parentId, node) };
}

export function renameNode(tree: Tree, id: PageId, title: string): Tree {
  return { ...tree, roots: replaceIn(tree.roots, id, (n) => ({ ...n, title })) };
}

/** Убирает узел вместе с поддеревом. Возвращает идентификаторы удалённых страниц. */
export function removeNode(
  tree: Tree,
  id: PageId,
): { tree: Tree; removed: PageId[] } {
  const node = findNode(tree, id);
  if (!node) return { tree, removed: [] };
  return {
    tree: { ...tree, roots: dropFrom(tree.roots, id) },
    removed: subtreeIds(node),
  };
}

/**
 * Можно ли перенести страницу под нового родителя.
 * Запрещает перенос внутрь собственного поддерева (FR-9).
 */
export function canMove(
  tree: Tree,
  id: PageId,
  newParentId: PageId | null,
): boolean {
  if (id === newParentId) return false;
  const node = findNode(tree, id);
  if (!node) return false;
  if (newParentId === null) return true;
  if (!findNode(tree, newParentId)) return false;
  return !subtreeIds(node).includes(newParentId);
}

export function moveNode(
  tree: Tree,
  id: PageId,
  newParentId: PageId | null,
): Tree {
  if (!canMove(tree, id, newParentId)) {
    throw new Error('Недопустимый перенос страницы');
  }
  const node = findNode(tree, id);
  if (!node) throw new Error(`Страница ${id} не найдена`);
  const without: Tree = { ...tree, roots: dropFrom(tree.roots, id) };
  return insertNode(without, newParentId, node);
}

/** Сдвигает страницу среди соседей: -1 вверх, +1 вниз. */
export function shiftNode(tree: Tree, id: PageId, delta: -1 | 1): Tree {
  return { ...tree, roots: shiftIn(tree.roots, id, delta) };
}

// --- внутреннее ---

function findIn(nodes: TreeNode[], id: PageId): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findIn(node.children, id);
    if (found) return found;
  }
  return null;
}

function appendTo(
  nodes: TreeNode[],
  parentId: PageId,
  node: TreeNode,
): TreeNode[] {
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...n.children, node] }
      : { ...n, children: appendTo(n.children, parentId, node) },
  );
}

function replaceIn(
  nodes: TreeNode[],
  id: PageId,
  fn: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) =>
    n.id === id ? fn(n) : { ...n, children: replaceIn(n.children, id, fn) },
  );
}

function dropFrom(nodes: TreeNode[], id: PageId): TreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: dropFrom(n.children, id) }));
}

function shiftIn(nodes: TreeNode[], id: PageId, delta: -1 | 1): TreeNode[] {
  const index = nodes.findIndex((n) => n.id === id);
  if (index === -1) {
    return nodes.map((n) => ({
      ...n,
      children: shiftIn(n.children, id, delta),
    }));
  }
  const target = index + delta;
  if (target < 0 || target >= nodes.length) return nodes;

  const next = [...nodes];
  const moved = next.splice(index, 1)[0];
  if (!moved) return nodes;
  next.splice(target, 0, moved);
  return next;
}
