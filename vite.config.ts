/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/** Подключает обработчик API к dev-серверу, чтобы не держать второй процесс. */
function apiPlugin(): PluginOption {
  return {
    name: 'microdocs-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const { handleApi } = await server.ssrLoadModule('/server/api.ts');
        const handled = await handleApi(req, res);
        if (!handled) next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    // --host, чтобы открывать с телефона в той же сети
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
