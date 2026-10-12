/**
 * Картинки, загруженные из приложения. Лежат среди вложений базы в `uploads/`
 * под именем из SHA-256 содержимого: одинаковый файл — один объект, а повторная
 * отправка того же имени пишет те же байты. Поэтому загрузке не нужны версии
 * и условия записи, а очередь может слать её сколько угодно раз.
 *
 *   uploads/<64 hex>.<ext>
 *
 * Только картинки, которые браузер показывает сам: SVG сюда не пускаем —
 * открытый напрямую с нашего адреса, он исполнил бы свои скрипты.
 */
export const UPLOAD_DIR = 'uploads';

/** Больше не принимаем: сервер держит тело в памяти целиком. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const NAME = new RegExp(`^${UPLOAD_DIR}/[0-9a-f]{64}\\.(${[...new Set(Object.values(UPLOAD_TYPES))].join('|')})$`);

/** Путь годится для загрузки из приложения. */
export function isUploadPath(path: string): boolean {
  return NAME.test(path);
}

export function uploadPath(sha256Hex: string, mime: string): string | null {
  const ext = UPLOAD_TYPES[mime];
  return ext ? `${UPLOAD_DIR}/${sha256Hex}.${ext}` : null;
}
