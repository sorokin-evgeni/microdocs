import { readFileSync } from 'node:fs';

/**
 * Отозванные клиентские сертификаты. Файл — по строке на сертификат:
 * отпечаток SHA-256 (как угодно записанный: с двоеточиями или без, в любом
 * регистре), дальше через пробел — что угодно, обычно имя и дата.
 * Пустые строки и строки с `#` пропускаются. Пишет его scripts/revokeUser.sh.
 *
 * Список отзыва в TLS (CRL) не подошёл: с ним Node требует список от каждого
 * центра, а у первого центра ключа нет — выпустить ему список нечем.
 */
export function parseRevoked(text: string): Set<string> {
  const revoked = new Set<string>();
  for (const line of text.split('\n')) {
    const first = line.trim().split(/\s+/)[0];
    if (!first || first.startsWith('#')) continue;
    const fingerprint = normalizeFingerprint(first);
    if (fingerprint) revoked.add(fingerprint);
  }
  return revoked;
}

/** Отпечаток в один вид: 64 шестнадцатеричных знака в нижнем регистре; иначе null. */
export function normalizeFingerprint(value: string): string | null {
  const hex = value.replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Список из файла. Нет файла — никто не отозван; файл есть, но не читается — ошибка. */
export function loadRevoked(path: string | undefined): Set<string> {
  if (!path) return new Set();
  try {
    return parseRevoked(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}
