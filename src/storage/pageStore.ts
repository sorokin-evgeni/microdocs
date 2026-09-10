import type { PageId, Tree } from '../types';

/**
 * Хранилище базы знаний. Набор операций намеренно повторяет раскладку в S3:
 * структура целиком лежит в одном объекте (`tree.json`), тело каждой страницы —
 * в отдельном (`pages/<id>.md`). Благодаря этому реализацию на IndexedDB можно
 * заменить на клиент к серверному прокси, не трогая остальной код.
 */
export interface PageStore {
  /** Структура базы; null, если базы ещё нет. */
  loadTree(): Promise<Tree | null>;
  saveTree(tree: Tree): Promise<void>;

  /** Тело страницы; пустая строка, если тела ещё нет. */
  loadBody(id: PageId): Promise<string>;
  saveBody(id: PageId, body: string): Promise<void>;

  deleteBodies(ids: PageId[]): Promise<void>;
}
