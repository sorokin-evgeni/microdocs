import { describe, expect, it } from 'vitest';
import { routeRequest } from './routes';

const origin = 'https://notes.example';
const req = (url: string, init: { method?: string; mode?: RequestMode; range?: boolean } = {}) => ({
  url: new URL(url, origin).href,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'cors',
  headers: new Headers(init.range ? { Range: 'bytes=0-' } : {}),
});

describe('маршруты service worker', () => {
  it('переход по любому адресу приложения — оболочка из кеша', () => {
    expect(routeRequest(req('/', { mode: 'navigate' }), origin)).toBe('shell');
    expect(routeRequest(req('/p/stranica-abc', { mode: 'navigate' }), origin)).toBe('shell');
  });

  it('файлы сборки — из кеша', () => {
    expect(routeRequest(req('/assets/index-abc.js'), origin)).toBe('static');
    expect(routeRequest(req('/emojibase/17/ru/data.json'), origin)).toBe('static');
  });

  it('вложения кешируются, даже если открыты переходом', () => {
    expect(routeRequest(req('/api/assets/a/b.png'), origin)).toBe('asset');
    expect(routeRequest(req('/api/assets/doc.pdf', { mode: 'navigate' }), origin)).toBe('asset');
  });

  it('API, запись, куски файлов и чужие адреса — мимо кеша', () => {
    expect(routeRequest(req('/api/tree'), origin)).toBe('network');
    expect(routeRequest(req('/api/pages/x', { mode: 'navigate' }), origin)).toBe('network');
    expect(routeRequest(req('/api/pages/x', { method: 'PUT' }), origin)).toBe('network');
    expect(routeRequest(req('/api/assets/v.mp4', { range: true }), origin)).toBe('network');
    expect(routeRequest(req('https://example.com/pic.png'), origin)).toBe('network');
  });
});
