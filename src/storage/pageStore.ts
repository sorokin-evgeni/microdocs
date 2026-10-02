import type { PageId, Tree } from '../types';
import type { TreeOp } from '../domain/treeOps';

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

/**
 * Дерево на устройстве относительно сервера: от какой версии оно происходит
 * и какие правки ещё не отправлены. Если сервер ушёл вперёд, эти правки
 * применяются заново поверх его дерева.
 */
export interface TreeSync {
  /** null — дерево с сервера ещё не приходило. */
  rev: number | null;
  ops: TreeOp[];
}

/** Локальное хранилище: ещё и помнит, от какой серверной версии каждая страница и дерево. */
export interface LocalStore extends PageStore {
  /** null — страница с сервера ещё не приходила. */
  loadBase(id: PageId): Promise<PageBase | null>;
  saveBase(id: PageId, base: PageBase): Promise<void>;
  loadTreeSync(): Promise<TreeSync>;
  saveTreeSync(sync: TreeSync): Promise<void>;
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

export type FetchedTree =
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'found'; tree: Tree; rev: number };

export type PutTreeResult =
  | { kind: 'saved'; rev: number }
  | { kind: 'conflict'; current: { tree: Tree; rev: number } | null };

/** Сервер: страницы и дерево с версиями. */
export interface RemoteStore extends PageStore {
  /** Тело страницы, если оно новее `knownRev`. */
  fetchPage(id: PageId, knownRev: number | null): Promise<FetchedPage>;
  putPage(id: PageId, body: string, condition: PutCondition): Promise<PutResult>;
  fetchTree(knownRev: number | null): Promise<FetchedTree>;
  putTree(tree: Tree, condition: PutCondition): Promise<PutTreeResult>;
}
