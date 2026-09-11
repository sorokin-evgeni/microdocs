import type { PageId, Tree } from '../../shared/types';

/**
 * Порт хранилища: что сервер умеет делать с базой, без единого упоминания
 * того, где это лежит. Сегодня за ним S3, завтра может быть Postgres —
 * ни HTTP-контракт, ни клиент от замены не меняются.
 *
 * `null` означает «ещё нет», а не ошибку.
 */
export interface BaseStorage {
  readTree(baseId: string): Promise<Tree | null>;
  writeTree(baseId: string, tree: Tree): Promise<void>;

  readPage(baseId: string, pageId: PageId): Promise<string | null>;
  writePage(baseId: string, pageId: PageId, markdown: string): Promise<void>;
  deletePage(baseId: string, pageId: PageId): Promise<void>;
}
