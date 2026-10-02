import type { PageId } from '../types';

/**
 * Очередь неотправленного. Хранит только ключи, а не содержимое: при отправке
 * берётся текущее локальное значение. Поэтому повторная отправка безопасна,
 * а очередь не расходится с локальными данными.
 *
 * Каждая запись помечена поколением: новая правка того же ключа его меняет.
 * Отправитель снимает запись, только если поколение то же, что он видел
 * до чтения значения, — иначе правка, сделанная пока шёл запрос, потерялась бы.
 *
 * Лежит в localStorage: она крошечная и должна пережить перезагрузку вкладки,
 * иначе после закрытия браузера офлайн-правки остались бы неотправленными.
 */
export type OutboxEntry = 'tree' | `page:${PageId}` | `del:${PageId}`;

interface Stored {
  /** Последнее выданное поколение. */
  seq: number;
  items: [OutboxEntry, number][];
}

export function createOutbox(baseId: string) {
  const key = `microdocs:outbox:${baseId}`;

  const read = (): Stored => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { seq: 0, items: [] };
      const parsed = JSON.parse(raw) as Stored | OutboxEntry[];
      // Прежний формат — просто список ключей.
      if (Array.isArray(parsed)) return { seq: 0, items: parsed.map((e) => [e, 0]) };
      return parsed;
    } catch {
      return { seq: 0, items: [] };
    }
  };

  const write = (stored: Stored) => {
    try {
      localStorage.setItem(key, JSON.stringify(stored));
    } catch {
      // Переполнение или запрет хранилища не должны ломать редактирование.
    }
  };

  return {
    list: (): OutboxEntry[] => read().items.map(([entry]) => entry),
    isEmpty: () => read().items.length === 0,

    /** Поколение записи; undefined — записи в очереди нет. */
    generation(entry: OutboxEntry): number | undefined {
      return read().items.find(([e]) => e === entry)?.[1];
    },

    add(entry: OutboxEntry) {
      const { seq, items } = read();
      // Правку страницы и её удаление держать одновременно бессмысленно.
      const opposite = entry.startsWith('del:')
        ? `page:${entry.slice(4)}`
        : entry.startsWith('page:')
          ? `del:${entry.slice(5)}`
          : null;

      const next = items.filter(([e]) => e !== entry && e !== opposite);
      next.push([entry, seq + 1]);
      write({ seq: seq + 1, items: next });
    },

    /** Снять запись, если с поколения `generation` её не трогали. */
    remove(entry: OutboxEntry, generation: number) {
      const stored = read();
      write({
        ...stored,
        items: stored.items.filter(([e, g]) => !(e === entry && g === generation)),
      });
    },
  };
}
