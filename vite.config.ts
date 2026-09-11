/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/** Подключает обработчик API к dev-серверу, чтобы не держать второй процесс. */
function apiPlugin(): PluginOption {
  return {
    name: 'microdocs-api',
    configureServer(server) {
      // Тесты поднимают свой Vite-сервер, API им не нужен.
      if (process.env.VITEST) return;

      // Хранилище создаётся при первом запросе и переиспользуется дальше:
      // раньше времени трогать S3 незачем.
      let ready: Promise<(req: never, res: never) => Promise<boolean>> | null =
        null;

      server.middlewares.use(async (req, res, next) => {
        ready ??= (async () => {
          const { createApi } = await server.ssrLoadModule('/server/api.ts');
          const { createStorage } = await server.ssrLoadModule(
            '/server/storage/index.ts',
          );
          return createApi(createStorage());
        })();

        const handleApi = await ready;
        if (!(await handleApi(req as never, res as never))) next();
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
