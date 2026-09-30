export type PageId = string;

/** Узел дерева. Тело страницы хранится отдельно, здесь только структура. */
export interface TreeNode {
  id: PageId;
  title: string;
  /** Эмодзи перед названием. Нет поля — нет иконки. */
  icon?: string;
  children: TreeNode[];
}

/**
 * Структура базы целиком. Как она ложится в хранилище — дело адаптера:
 * в S3 это один объект, в Postgres может быть таблицей.
 */
export interface Tree {
  roots: TreeNode[];
  /** Убранные в архив ветки, в порядке архивации. В старых базах поля нет. */
  archive?: ArchivedNode[];
}

/** Ветка в архиве и место, откуда её убрали: туда она и восстанавливается. */
export interface ArchivedNode {
  node: TreeNode;
  /** Родитель на момент архивации; null — верхний уровень. */
  parentId: PageId | null;
  /** Позиция среди соседей на момент архивации. */
  index: number;
}
