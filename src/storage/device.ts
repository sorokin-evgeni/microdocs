/**
 * Идентификатор этой установки приложения. Сервер по нему группирует правки
 * одного устройства в одну версию истории; личность он не определяет —
 * это делает сертификат.
 */
const KEY = 'microdocs:device';

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = crypto.randomUUID();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    // Без хранилища — свой на каждый запуск: группировка просто реже срабатывает.
    cached ??= crypto.randomUUID();
  }
  return cached;
}
