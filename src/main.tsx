import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/inter/opsz-italic.css';
// После стилей Mantine, чтобы перекрывать их при равной специфичности.
import './document.css';

import { theme } from './theme';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root');

// Без сети интерфейс открывается из кеша service worker (src/serviceWorker/sw.ts).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
);
