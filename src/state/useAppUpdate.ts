import { useCallback, useEffect, useState } from 'react';
import { AUTOSAVE_DELAY } from './useAutosave';

/**
 * Новая версия интерфейса. Service worker скачивает её в фоне и ждёт;
 * хук возвращает, чем её включить, или null, если ждать нечего.
 *
 * Включается по кнопке, а не сама: перезагрузка посреди набора сбивает,
 * а приложения на телефоне и маке открыты подолгу.
 */
export function useAppUpdate(): (() => void) | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    let registration: ServiceWorkerRegistration | null = null;

    // Новая версия — та, что установилась, пока страницей управляет прежняя.
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        if (worker.state === 'installed' && sw.controller) setWaiting(worker);
      };
      check();
      worker.addEventListener('statechange', check);
    };

    void sw.ready.then((reg) => {
      registration = reg;
      watch(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    });

    // Браузер проверяет обновления при открытии страницы; приложение же
    // не перезагружают днями — проверяем, когда к нему возвращаются.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const apply = useCallback(() => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    // Правка, набранная перед нажатием, ещё может ждать записи — даём ей записаться.
    setTimeout(() => waiting.postMessage('skip-waiting'), AUTOSAVE_DELAY + 400);
  }, [waiting]);

  return waiting ? apply : null;
}
