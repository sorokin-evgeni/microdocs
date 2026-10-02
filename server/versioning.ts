import type { BaseStorage, DocRef, StoredDoc } from './storage/port';

/**
 * Версии документов: номер версии, условная запись и группировка правок.
 *
 * Номер версии — `rev`, он же ETag в HTTP. Запись с `If-Match` проходит,
 * только если на сервере всё ещё та версия, от которой правил клиент;
 * иначе отказ, и клиент разбирается с расхождением сам.
 *
 * Группировка: правки одного устройства в пределах BURST_WINDOW от начала
 * серии оставляют в истории одну версию — последнюю. Промежуточные
 * удаляются из истории хранилища насовсем.
 */
export const BURST_WINDOW = 5 * 60_000;

/** Условие записи из заголовков `If-Match` / `If-None-Match`. */
export type Precondition =
  | { kind: 'none' }
  /** Записать, только если текущая версия — `rev`. */
  | { kind: 'match'; rev: number }
  /** Записать, только если документа ещё нет. */
  | { kind: 'absent' };

export type WriteResult =
  | { ok: true; rev: number }
  /** Условие не выполнено; `current` — что лежит сейчас (null — ничего). */
  | { ok: false; current: StoredDoc | null };

export function etag(rev: number): string {
  return `"${rev}"`;
}

/**
 * Номер версии из ETag. Слабые ETag (`W/"7"`) тоже принимаем: прокси
 * бывает ослабляет их при сжатии. null — не номер версии.
 */
export function parseEtag(value: string): number | null {
  const match = /^(?:W\/)?"?(\d{1,15})"?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** Разбор условий записи. null — заголовок есть, но разобрать нельзя. */
export function parsePrecondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined,
): Precondition | null {
  if (ifMatch !== undefined) {
    const rev = parseEtag(ifMatch);
    return rev === null ? null : { kind: 'match', rev };
  }
  if (ifNoneMatch !== undefined) {
    return ifNoneMatch.trim() === '*' ? { kind: 'absent' } : null;
  }
  return { kind: 'none' };
}

/**
 * Блокировки по ключу в памяти процесса: проверка версии и запись
 * не перемежаются с чужими. Этого достаточно, пока сервер — один процесс.
 */
export function createLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    // Хвост больше никому не нужен — не держим ключ в памяти вечно.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

export interface VersionedWrite {
  precondition: Precondition;
  device: string | null;
  now: number;
}

/** Записать новую версию документа. Звать под блокировкой его ключа. */
export async function writeVersioned(
  storage: BaseStorage,
  baseId: string,
  ref: DocRef,
  body: string,
  { precondition, device, now }: VersionedWrite,
): Promise<WriteResult> {
  const current = await storage.headDoc(baseId, ref);

  const rejected =
    (precondition.kind === 'match' && (!current || current.rev !== precondition.rev)) ||
    (precondition.kind === 'absent' && current !== null);
  if (rejected) {
    return { ok: false, current: current ? await storage.readDoc(baseId, ref) : null };
  }

  const rev = (current?.rev ?? 0) + 1;
  // Та же серия: то же устройство, и серия началась недавно. Через смену
  // устройства не схлопываем — в истории должно остаться, что было до чужой правки.
  const sameBurst =
    current !== null &&
    device !== null &&
    current.device === device &&
    current.burstStart !== null &&
    now - current.burstStart < BURST_WINDOW;

  const versionId = await storage.writeDoc(baseId, ref, body, {
    rev,
    device,
    burstStart: sameBurst ? current.burstStart : now,
  });

  // Удаляем только что заменённую версию и ничего больше. Если история
  // не ведётся (нет идентификаторов), удалять нечего — и опасно: удалили бы текущую.
  if (sameBurst && current.versionId && versionId && versionId !== current.versionId) {
    try {
      await storage.deleteDocVersion(baseId, ref, current.versionId);
    } catch (error) {
      // Запись уже состоялась; лишняя версия в истории — не повод для отказа.
      console.error('Не удалось убрать промежуточную версию:', error);
    }
  }

  return { ok: true, rev };
}
