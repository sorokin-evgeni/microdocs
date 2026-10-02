import { describe, expect, it } from 'vitest';
import { assetLinkFromUrl, assetUrl, linkedPageIds, parseLink } from './links';

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

  it('путь вложения одинаков, сырой он в тексте или закодированный', () => {
    const raw = parseLink('microdocs:asset/Root_1/Отчёт+1.pdf');
    const encoded = parseLink(`microdocs:asset/Root_1/${encodeURIComponent('Отчёт')}+1.pdf`);
    expect(raw).toEqual({ kind: 'asset', path: 'Root_1/Отчёт+1.pdf' });
    expect(encoded).toEqual(raw);
  });

  it('адрес вложения на сервере кодирует части пути, но не слэши', () => {
    expect(assetUrl('Root_1/Отчёт за год+1.pdf')).toBe(
      `/api/assets/Root_1/${encodeURIComponent('Отчёт за год+1.pdf')}`,
    );
  });

  it('адрес своего сервера превращается обратно в ссылку на вложение', () => {
    const url = assetUrl('Root_1/Отчёт.pdf');
    expect(assetLinkFromUrl(url)).toBe('microdocs:asset/Root_1/Отчёт.pdf');
    expect(assetLinkFromUrl(window.location.origin + url)).toBe('microdocs:asset/Root_1/Отчёт.pdf');
  });

  it('чужой адрес вложением не становится', () => {
    expect(assetLinkFromUrl('https://example.com/api/assets/a.png')).toBeNull();
    expect(assetLinkFromUrl('/api/tree')).toBeNull();
  });
});

describe('страницы, на которые ссылается текст', () => {
  it('по порядку, без повторов, без вложений и внешних ссылок', () => {
    const текст = [
      '[a](microdocs:page/aaa) и [b](microdocs:page/bbb-1)',
      '![картинка](microdocs:asset/x/y.png) [сайт](https://example.com)',
      'снова [a](microdocs:page/aaa)',
    ].join('\n');
    expect(linkedPageIds(текст)).toEqual(['aaa', 'bbb-1']);
  });

  it('ссылок нет — пусто', () => {
    expect(linkedPageIds('просто текст')).toEqual([]);
  });
});
