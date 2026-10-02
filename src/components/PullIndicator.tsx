import { Loader, Paper } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { PULL_THRESHOLD, type PullState } from '../state/usePullToRefresh';

/**
 * Кружок, который выезжает сверху, пока тянут страницу вниз. Стрелка
 * разворачивается по мере натяжения: перевернулась — отпускай, обновится.
 * Пока обновляется — крутится.
 */
export function PullIndicator({ pull, refreshing }: PullState) {
  if (pull === 0 && !refreshing) return null;
  const ready = pull >= PULL_THRESHOLD;

  return (
    <Paper
      shadow="sm"
      radius="xl"
      withBorder
      aria-live="polite"
      aria-label={refreshing ? 'Обновляется' : ready ? 'Отпустите, чтобы обновить' : 'Потяните, чтобы обновить'}
      style={{
        position: 'fixed',
        // Прячется прямо под шапкой (на телефоне она есть, на компьютере нулевая)
        // и выезжает из-под неё: шапка выше по слою.
        top: 'calc(var(--app-shell-header-offset, 0px) - 36px)',
        left: '50%',
        zIndex: 99,
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Выезжает из-под шапки на величину натяжения.
        transform: `translate(-50%, ${pull}px)`,
        transition: refreshing ? 'transform 150ms' : undefined,
        pointerEvents: 'none',
      }}
    >
      {refreshing ? (
        <Loader size={16} />
      ) : (
        <IconArrowDown
          size={18}
          style={{
            opacity: Math.min(1, pull / PULL_THRESHOLD),
            transform: `rotate(${ready ? 180 : (pull / PULL_THRESHOLD) * 150}deg)`,
            transition: 'transform 120ms',
          }}
        />
      )}
    </Paper>
  );
}
