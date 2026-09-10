export type PageId = string;

/** Узел дерева. Тело страницы хранится отдельно, здесь только структура. */
export interface TreeNode {
  id: PageId;
  title: string;
  children: TreeNode[];
}

/**
 * Структура базы целиком — то, что уезжает в `<baseId>/tree.json`.
 * Сам `baseId` здесь не хранится: им параметризовано хранилище, и он уже
 * закодирован в пути объекта.
 */
export interface Tree {
  roots: TreeNode[];
}
