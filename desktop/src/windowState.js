// @ts-check
/**
 * Размер и положение окна между запусками. Чистые функции без Electron,
 * чтобы их можно было проверить тестами.
 */

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ bounds: Rect | null, maximized: boolean, fullscreen: boolean }} WindowState
 */

export const DEFAULT_SIZE = { width: 1200, height: 800 };
export const MIN_SIZE = { width: 480, height: 360 };

/** @type {WindowState} */
export const EMPTY_STATE = { bounds: null, maximized: false, fullscreen: false };

/**
 * Разбирает сохранённое. Всё непонятное — как будто сохранённого нет:
 * испорченный файл не должен мешать запуску.
 *
 * @param {string | null} raw
 * @returns {WindowState}
 */
export function parseState(raw) {
  if (!raw) return EMPTY_STATE;
  try {
    const data = JSON.parse(raw);
    const b = data?.bounds;
    const bounds =
      b && [b.x, b.y, b.width, b.height].every(Number.isFinite)
        ? { x: b.x, y: b.y, width: b.width, height: b.height }
        : null;
    return {
      bounds,
      maximized: data?.maximized === true,
      fullscreen: data?.fullscreen === true,
    };
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * Где открыть окно. Сохранённое положение берётся, только если окно хотя бы
 * заметно видно на одном из экранов: монитор могли отключить, и окно
 * открылось бы за пределами видимого.
 *
 * @param {WindowState} state
 * @param {Rect[]} workAreas рабочие области подключённых экранов
 * @returns {Partial<Rect> & { width: number, height: number }}
 */
export function initialBounds(state, workAreas) {
  const saved = state.bounds;
  if (!saved) return { ...DEFAULT_SIZE };

  const width = Math.max(saved.width, MIN_SIZE.width);
  const height = Math.max(saved.height, MIN_SIZE.height);
  const rect = { x: saved.x, y: saved.y, width, height };

  const visible = workAreas.some((area) => {
    const w = overlap(rect.x, rect.width, area.x, area.width);
    const h = overlap(rect.y, rect.height, area.y, area.height);
    return w >= 100 && h >= 50;
  });

  // Экрана не стало — размер оставляем, а место выберет система (по центру).
  return visible ? rect : { width, height };
}

/**
 * @param {number} a начало первого отрезка
 * @param {number} aLen длина первого
 * @param {number} b начало второго
 * @param {number} bLen длина второго
 */
function overlap(a, aLen, b, bLen) {
  return Math.max(0, Math.min(a + aLen, b + bLen) - Math.max(a, b));
}
