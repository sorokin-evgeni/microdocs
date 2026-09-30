// @ts-check
/**
 * microdocs для macOS — окно с веб-версией. Интерфейс приходит с сервера,
 * без сети его отдаёт service worker из кеша, данные лежат в IndexedDB
 * этого же окна. Своего кода интерфейса у приложения нет.
 *
 * Клиентский сертификат берётся из Связки ключей: Chromium сам предлагает те,
 * что подписаны центром, который назвал сервер, а Electron по умолчанию
 * выбирает первый из них.
 */
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_STATE, MIN_SIZE, initialBounds, parseState } from './windowState.js';
import { classifyLoadError } from './loadError.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Адрес сервера. MICRODOCS_URL — для проверки на своём стенде. */
const APP_URL =
  process.env.MICRODOCS_URL ??
  JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).microdocsUrl;

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

function readState() {
  try {
    return parseState(readFileSync(stateFile(), 'utf8'));
  } catch {
    return EMPTY_STATE;
  }
}

/** @param {BrowserWindow} win */
function saveState(win) {
  const state = {
    // Для развёрнутого окна запоминаем обычный размер — к нему вернётся «Свернуть в окно».
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
  };
  try {
    mkdirSync(dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state));
  } catch (error) {
    console.error('Не удалось запомнить окно:', error);
  }
}

function createWindow() {
  const state = readState();
  const win = new BrowserWindow({
    ...initialBounds(
      state,
      screen.getAllDisplays().map((d) => d.workArea),
    ),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'microdocs',
    show: false,
    // Цвет фона страницы, чтобы при запуске не мелькало белым в тёмной теме.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242424' : '#ffffff',
  });

  if (state.fullscreen) win.setFullScreen(true);
  else if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 — загрузку прервали сами (например, ушли на другую страницу).
    if (!isMainFrame || code === -3) return;
    void win.loadFile(join(here, 'error.html'), {
      query: { kind: classifyLoadError(code), code: `${code} ${description}`, url },
    });
  });

  void win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  // Как принято на маке: закрыли окно — приложение осталось в доке, клик по нему открывает окно.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
