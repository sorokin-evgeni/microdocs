import type { PageId } from '../../shared/types';

/**
 * Порт хранилища: что сервер умеет делать с базой, без единого упоминания
 * того, где это лежит. Сегодня за ним S3, завтра может быть Postgres —
 * ни HTTP-контракт, ни клиент от замены не меняются.
 *
 * Дерево и страницы версионируются одинаково, поэтому для хранилища это
 * «документы»: текст плюс метаданные версии. Дерево — JSON, страница — Markdown;
 * разбирать их — дело API.
 *
 * `null` означает «ещё нет», а не ошибку.
 */
export interface BaseStorage {
  readDoc(baseId: string, ref: DocRef): Promise<StoredDoc | null>;
  /** Только метаданные текущей версии, без тела. */
  headDoc(baseId: string, ref: DocRef): Promise<DocMeta | null>;
  /** Записать новую версию. Возвращает её идентификатор в истории хранилища. */
  writeDoc(baseId: string, ref: DocRef, body: string, meta: WriteMeta): Promise<string | null>;
  /** Удалить одну версию из истории насовсем — для группировки правок. */
  deleteDocVersion(baseId: string, ref: DocRef, versionId: string): Promise<void>;

  deletePage(baseId: string, pageId: PageId): Promise<void>;

  /** Вложение по пути внутри вложений базы, например `buildin/5f54/Ticket.pdf`. */
  readAsset(baseId: string, path: string): Promise<Asset | null>;
}

export type DocRef = { kind: 'tree' } | { kind: 'page'; id: PageId };

/** Что записывается вместе с версией. */
export interface WriteMeta {
  /** Номер версии: 1, 2, 3… У записанного до появления номеров — 0. */
  rev: number;
  /** Устройство, которое записало; null — неизвестно. */
  device: string | null;
  /** Когда началась серия правок, в которую входит эта версия (мс). */
  burstStart: number | null;
}

export interface DocMeta extends WriteMeta {
  /** Идентификатор версии в истории хранилища; null — истории нет. */
  versionId: string | null;
}

export interface StoredDoc {
  body: string;
  meta: DocMeta;
}

/** Файл как он лежит в хранилище. Тип — тот, с которым его записали, если записали. */
export interface Asset {
  body: Uint8Array;
  contentType: string | null;
}
