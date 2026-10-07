import { describe, expect, it } from 'vitest';
import { loadRevoked, normalizeFingerprint, parseRevoked } from './revocation';

const A = 'AB:'.repeat(31) + 'AB';
const B = 'cd'.repeat(32);

describe('отозванные сертификаты', () => {
  it('отпечаток приводится к одному виду', () => {
    expect(normalizeFingerprint(A)).toBe('ab'.repeat(32));
    expect(normalizeFingerprint(B.toUpperCase())).toBe(B);
    expect(normalizeFingerprint('не отпечаток')).toBeNull();
    expect(normalizeFingerprint('ab')).toBeNull();
  });

  it('читает отпечатки, пропуская комментарии, пустые строки и мусор', () => {
    const revoked = parseRevoked(`# отозванные\n\n${A} anna 2026-10-07\n${B}\nчепуха\n`);
    expect([...revoked]).toEqual(['ab'.repeat(32), B]);
  });

  it('нет файла — никто не отозван', () => {
    expect(loadRevoked(undefined).size).toBe(0);
    expect(loadRevoked('/nonexistent/revoked.txt').size).toBe(0);
  });
});
