/**
 * Как service worker обходится с запросом:
 *   shell   — переход по адресу приложения: index.html из кеша;
 *   static  — файлы сборки: из кеша, иначе из сети;
 *   asset   — вложение: из кеша, иначе из сети с сохранением в кеш;
 *   network — не трогаем (API: данные живут в IndexedDB, а не в кеше).
 */
export type Route = 'shell' | 'static' | 'asset' | 'network';

export function routeRequest(
  request: Pick<Request, 'method' | 'mode' | 'url' | 'headers'>,
  origin: string,
): Route {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'network';
  // Кусками (Range) браузер тянет видео и аудио — такой ответ кешировать нельзя.
  if (url.pathname.startsWith('/api/assets/')) return request.headers.has('range') ? 'network' : 'asset';
  if (url.pathname.startsWith('/api/')) return 'network';
  if (request.mode === 'navigate') return 'shell';
  return 'static';
}
