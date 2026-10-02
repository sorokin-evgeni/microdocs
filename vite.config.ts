/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
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
          return createApi(createStorage(), undefined, { requirePrecondition: true });
        })();

        const handleApi = await ready;
        if (!(await handleApi(req as never, res as never))) next();
      });
    },
  };
}

/**
 * Собирает service worker и вписывает в него, что класть в кеш: все файлы
 * сборки и public/. Версия — хеш их содержимого: изменилось хоть что-то —
 * браузер увидит новый sw.js и поставит новую версию.
 */
function serviceWorkerPlugin(): PluginOption {
  let publicDir = '';
  return {
    name: 'microdocs-sw',
    apply: 'build',
    // После встроенных плагинов: к этому моменту в сборке уже есть index.html и CSS.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.fileName.endsWith('.map')) continue;
        files.push(`/${item.fileName}`);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const file of listFiles(publicDir)) {
        files.push(`/${relative(publicDir, file).split('\\').join('/')}`);
        hash.update(readFileSync(file));
      }

      const result = await build({
        entryPoints: ['src/serviceWorker/sw.ts'],
        bundle: true,
        write: false,
        minify: true,
        format: 'iife',
        target: 'es2020',
        define: {
          __PRECACHE__: JSON.stringify(files.sort()),
          __VERSION__: JSON.stringify(hash.digest('hex').slice(0, 12)),
        },
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: result.outputFiles[0]!.text });
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

export default defineConfig({
  plugins: [react(), apiPlugin(), serviceWorkerPlugin()],
  server: {
    // --host, чтобы открывать с телефона в той же сети
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
