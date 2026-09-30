import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

/**
 * Светлая или тёмная тема. Пока не нажата — как в системе; выбор Mantine
 * запоминает в localStorage сам.
 */
export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const isDark = useComputedColorScheme('light', { getInitialValueInEffect: false }) === 'dark';
  const label = isDark ? 'Светлая тема' : 'Тёмная тема';

  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size={26}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
    </ActionIcon>
  );
}
