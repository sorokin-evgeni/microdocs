import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '../theme';

const withProvider = (ui: ReactNode) => <MantineProvider theme={theme}>{ui}</MantineProvider>;

/** Компоненты Mantine работают только внутри провайдера. */
export function renderUI(ui: ReactNode) {
  const result = render(withProvider(ui));
  /** Та же отрисовка с новыми свойствами: состояние компонента сохраняется. */
  const rerenderUI = (next: ReactNode) => result.rerender(withProvider(next));
  return { ...result, rerenderUI };
}
