/**
 * Service worker: без сети интерфейс открывается из кеша. Нужен и вебу,
 * и приложениям для Android и Mac — они показывают ту же страницу.
 *
 * Собирается отдельно (serviceWorkerPlugin в vite.config.ts), список файлов
 * сборки и версия подставляются при сборке. Новая версия ставится в фоне
 * и ждёт, пока в интерфейсе не нажмут «Обновить» (useAppUpdate).
 */
import { routeRequest, type Route } from './routes';

declare const __PRECACHE__: string[];
declare const __VERSION__: string;

// Типы воркера (lib WebWorker) не уживаются в одном проекте с DOM — описываем нужное.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
declare const self: {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

const SHELL_PREFIX = 'microdocs-shell-';
const SHELL_CACHE = SHELL_PREFIX + __VERSION__;
/** Вложения переживают смену версий: адрес вложения не меняется. */
const ASSET_CACHE = 'microdocs-assets';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(__PRECACHE__)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE) await caches.delete(key);
      }
      // Первая установка: взять под себя уже открытую страницу, чтобы кешировать вложения сразу.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request, self.location.origin);
  if (route !== 'network') event.respondWith(respond(route, event.request));
});

async function respond(route: Exclude<Route, 'network'>, request: Request): Promise<Response> {
  if (route === 'shell') {
    return (await caches.match('/index.html', { cacheName: SHELL_CACHE })) ?? fetch(request);
  }

  const cached = await caches.match(request.url);
  if (cached) return cached;

  const response = await fetch(request);
  if (route === 'asset' && response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request.url, response.clone());
  }
  return response;
}
