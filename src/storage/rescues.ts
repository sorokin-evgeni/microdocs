import type { PageId } from '../types';

/**
 * Версии страниц, проигравшие конфликт: правка этого устройства, которую
 * заменила версия с другого. Лежат, пока человек не решит — вернуть свою
 * или забыть, — и переживают перезагрузку, иначе закрытая вкладка
 * означала бы потерю текста.
 *
 * В localStorage: их мало и они небольшие, а IndexedDB ради этого лишняя сложность.
 */
export interface Rescue {
  id: PageId;
  text: string;
  /** Когда заменили, мс. */
  at: number;
}

export function createRescues(baseId: string) {
  const key = `microdocs:rescues:${baseId}`;

  const read = (): Rescue[] => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Rescue[]) : [];
    } catch {
      return [];
    }
  };

  const write = (rescues: Rescue[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(rescues));
    } catch {
      // Не поместилось — тост всё равно покажется, просто не переживёт перезагрузку.
    }
  };

  return {
    list: read,
    get: (id: PageId) => read().find((r) => r.id === id) ?? null,
    /** У страницы хранится одна, последняя проигравшая версия. */
    add(rescue: Rescue) {
      write([...read().filter((r) => r.id !== rescue.id), rescue]);
    },
    remove(id: PageId) {
      write(read().filter((r) => r.id !== id));
    },
  };
}

export type Rescues = ReturnType<typeof createRescues>;
