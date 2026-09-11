export type PageId = string;

/** Узел дерева. Тело страницы хранится отдельно, здесь только структура. */
export interface TreeNode {
  id: PageId;
  title: string;
  children: TreeNode[];
}

/**
 * Структура базы целиком. Как она ложится в хранилище — дело адаптера:
 * в S3 это один объект, в Postgres может быть таблицей.
 */
export interface Tree {
  roots: TreeNode[];
}
