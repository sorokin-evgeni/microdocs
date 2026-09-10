import type { PageId } from '../types';

/**
 * Очередь неотправленного. Хранит только ключи, а не содержимое: при отправке
 * берётся текущее локальное значение. Поэтому повторная отправка безопасна,
 * а очередь не расходится с локальными данными.
 *
 * Лежит в localStorage: она крошечная и должна пережить перезагрузку вкладки,
 * иначе после закрытия браузера офлайн-правки остались бы неотправленными.
 */
export type OutboxEntry = 'tree' | `page:${PageId}` | `del:${PageId}`;

export function createOutbox(baseId: string) {
  const key = `microdocs:outbox:${baseId}`;

  const read = (): OutboxEntry[] => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  };

  const write = (entries: OutboxEntry[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      // Переполнение или запрет хранилища не должны ломать редактирование.
    }
  };

  return {
    list: read,
    isEmpty: () => read().length === 0,

    add(entry: OutboxEntry) {
      const entries = read();
      // Правку страницы и её удаление держать одновременно бессмысленно.
      const opposite = entry.startsWith('del:')
        ? `page:${entry.slice(4)}`
        : entry.startsWith('page:')
          ? `del:${entry.slice(5)}`
          : null;

      const next = entries.filter((e) => e !== entry && e !== opposite);
      next.push(entry);
      write(next);
    },

    remove(entry: OutboxEntry) {
      write(read().filter((e) => e !== entry));
    },
  };
}
