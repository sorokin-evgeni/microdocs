import { assetUrl } from '../domain/links';

/**
 * Файлы вложений на устройстве — в том же кеше, из которого их отдаёт
 * service worker (src/serviceWorker/sw.ts). Загруженная картинка кладётся
 * туда сразу: показывается без сети, а очередь берёт её оттуда при отправке.
 *
 * Кеш один на все версии приложения: адрес вложения от версии не зависит.
 *
 * Cache Storage есть только в защищённом контексте (https, localhost).
 * Без него `available` — false, и загрузка идёт сразу в сеть.
 */
export const ASSET_CACHE = 'microdocs-assets';

export interface AssetCache {
  available: boolean;
  put(path: string, blob: Blob): Promise<void>;
  /** null — нет: не клали или браузер вычистил. */
  get(path: string): Promise<Blob | null>;
}

/** Ключ — полный адрес: так запрос ищет service worker. */
const key = (path: string) => new URL(assetUrl(path), window.location.origin).href;

export function createAssetCache(): AssetCache {
  const available = typeof caches !== 'undefined';
  return {
    available,
    async put(path, blob) {
      if (!available) return;
      const cache = await caches.open(ASSET_CACHE);
      await cache.put(
        key(path),
        new Response(blob, {
          headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size) },
        }),
      );
    },
    async get(path) {
      if (!available) return null;
      const response = await caches.match(key(path), { cacheName: ASSET_CACHE });
      return response ? await response.blob() : null;
    },
  };
}
