import type { MouseEvent } from 'react';
import { Anchor, Text } from '@mantine/core';
import logoUrl from '../logo.svg';

interface Props {
  onOpenRoot: () => void;
}

/**
 * Логотип с названием — ссылка на корень базы. Обычный щелчок переходит без
 * перезагрузки, чтобы не потерять отложенную правку; с Ctrl или Cmd браузер
 * откроет корень в новой вкладке, как у любой ссылки.
 */
export function Brand({ onOpenRoot }: Props) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenRoot();
  };

  return (
    <Anchor
      href="/"
      onClick={handleClick}
      underline="never"
      c="inherit"
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%' }}
    >
      <img src={logoUrl} alt="" width={20} height={20} />
      <Text component="span" size="sm" fw={600}>
        microdocs
      </Text>
    </Anchor>
  );
}
