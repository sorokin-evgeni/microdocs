import { useEffect, useRef, useState } from 'react';

/** Насколько надо потянуть (в пикселях индикатора), чтобы при отпускании обновилось. */
export const PULL_THRESHOLD = 64;
/** Дальше индикатор не едет, как бы ни тянули. */
const PULL_MAX = 96;
/** Палец проходит больше, чем едет индикатор: тянется туго, как в системном жесте. */
const RESISTANCE = 0.5;

export interface PullState {
  /** Насколько вытянут индикатор, 0 — не тянут. */
  pull: number;
  refreshing: boolean;
}

/**
 * «Потяни, чтобы обновить»: палец вниз, когда страница уже в самом верху.
 * Своё, а не системное: в приложении для Android и в иконке на экране «Домой»
 * у iPhone системного жеста нет, а где есть — он перезагружает страницу целиком,
 * хотя достаточно сверить данные с сервером (`onRefresh`).
 *
 * Жесты внутри `ignore` (списка страниц, открытых окон) не считаются.
 */
export function usePullToRefresh(
  onRefresh: () => Promise<unknown>,
  ignore: (target: Element) => boolean = () => false,
): PullState {
  const [state, setState] = useState<PullState>({ pull: 0, refreshing: false });
  const latest = useRef({ onRefresh, ignore });
  latest.current = { onRefresh, ignore };

  useEffect(() => {
    let startY: number | null = null;
    let pull = 0;
    let busy = false;

    const onStart = (event: TouchEvent) => {
      const target = event.target as Element | null;
      if (busy || event.touches.length !== 1 || window.scrollY > 0) return;
      if (target && latest.current.ignore(target)) return;
      startY = event.touches[0]!.clientY;
      pull = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const dy = event.touches[0]!.clientY - startY;
      // Повели вверх или страница успела уехать — это прокрутка, а не жест.
      if (dy <= 0 || window.scrollY > 0) {
        if (pull) setState({ pull: 0, refreshing: false });
        startY = null;
        pull = 0;
        return;
      }
      pull = Math.min(PULL_MAX, dy * RESISTANCE);
      setState({ pull, refreshing: false });
    };

    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (pull < PULL_THRESHOLD) {
        pull = 0;
        setState({ pull: 0, refreshing: false });
        return;
      }
      pull = 0;
      busy = true;
      setState({ pull: PULL_THRESHOLD, refreshing: true });
      void latest.current
        .onRefresh()
        .catch(() => {})
        .finally(() => {
          busy = false;
          setState({ pull: 0, refreshing: false });
        });
    };

    // Касание прервала система (звонок, жест «назад») — это не «отпустил».
    const onCancel = () => {
      if (startY === null) return;
      startY = null;
      pull = 0;
      setState({ pull: 0, refreshing: false });
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  return state;
}
