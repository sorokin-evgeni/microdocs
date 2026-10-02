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

/**
 * Серверная версия, от которой происходит локальная копия страницы:
 * номер и текст. Номер уходит в `If-Match`, текст — общий предок при слиянии.
 */
export interface PageBase {
  rev: number;
  text: string;
}

/** Локальное хранилище: ещё и помнит, от какой серверной версии каждая страница. */
export interface LocalStore extends PageStore {
  /** null — страница с сервера ещё не приходила. */
  loadBase(id: PageId): Promise<PageBase | null>;
  saveBase(id: PageId, base: PageBase): Promise<void>;
}

export type FetchedPage =
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'found'; body: string; rev: number };

export type PutResult =
  | { kind: 'saved'; rev: number }
  /** Версия на сервере другая; `current` — что там сейчас, null — страницы нет. */
  | { kind: 'conflict'; current: { body: string; rev: number } | null };

/** Условие записи: «если версия всё ещё rev» или «если страницы ещё нет». */
export type PutCondition = { rev: number } | 'absent';

/** Сервер: страницы с версиями. */
export interface RemoteStore extends PageStore {
  /** Тело страницы, если оно новее `knownRev`. */
  fetchPage(id: PageId, knownRev: number | null): Promise<FetchedPage>;
  putPage(id: PageId, body: string, condition: PutCondition): Promise<PutResult>;
}
