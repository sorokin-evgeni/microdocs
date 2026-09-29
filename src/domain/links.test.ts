import { describe, expect, it } from 'vitest';
import { parseLink } from './links';

describe('ссылки', () => {
  it('различает страницу, вложение и внешний адрес', () => {
    expect(parseLink('microdocs:page/6c55bbc7-0ee5-4667-af33-bb8a02be42ba')).toEqual({
      kind: 'page',
      id: '6c55bbc7-0ee5-4667-af33-bb8a02be42ba',
    });
    expect(parseLink('microdocs:asset/buildin/5f54/Ticket.pdf')).toEqual({
      kind: 'asset',
      path: 'buildin/5f54/Ticket.pdf',
    });
    expect(parseLink('https://example.com')).toEqual({ kind: 'external', href: 'https://example.com' });
  });
});
