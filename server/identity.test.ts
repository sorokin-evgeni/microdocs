import { afterEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { resolveBaseId } from './identity';

/** Запрос с клиентским сертификатом, каким его видит Node. */
function withCertificate(cn: string | string[] | undefined): IncomingMessage {
  return {
    socket: {
      getPeerCertificate: () => (cn === undefined ? {} : { subject: { CN: cn } }),
    },
  } as unknown as IncomingMessage;
}

/** Запрос по обычному HTTP: сертификата нет вовсе. */
const withoutTls = { socket: {} } as unknown as IncomingMessage;

describe('кто пришёл', () => {
  afterEach(() => {
    delete process.env.MICRODOCS_DEV_BASE;
  });

  it('берёт владельца из CN сертификата', () => {
    expect(resolveBaseId(withCertificate('Evgeny'))).toBe('evgeny');
  });

  it('из массива CN берёт первый', () => {
    expect(resolveBaseId(withCertificate(['Alpha', 'Beta']))).toBe('alpha');
  });

  it('CN без единой латинской буквы владельцем не становится', () => {
    expect(resolveBaseId(withCertificate('Евгений'))).toBeNull();
  });

  it('приводит CN к безопасному виду', () => {
    expect(resolveBaseId(withCertificate('Evgeny Sorokin'))).toBe(
      'evgeny-sorokin',
    );
    expect(resolveBaseId(withCertificate('a/../b'))).toBe('a-b');
  });

  it('без CN владельца нет', () => {
    expect(resolveBaseId(withCertificate(undefined))).toBeNull();
  });

  it('CN из одних недопустимых символов даёт null, а не пустую базу', () => {
    expect(resolveBaseId(withCertificate('///'))).toBeNull();
  });

  it('без TLS работает база для разработки', () => {
    expect(resolveBaseId(withoutTls)).toBe('default');

    process.env.MICRODOCS_DEV_BASE = 'проба';
    expect(resolveBaseId(withoutTls)).toBe('проба');
  });
});
