import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZE, initialBounds, parseState } from './windowState.js';

const screen = { x: 0, y: 0, width: 1440, height: 900 };

describe('состояние окна', () => {
  it('испорченный файл — как будто сохранённого нет', () => {
    expect(parseState('{не json')).toEqual({ bounds: null, maximized: false, fullscreen: false });
    expect(parseState(JSON.stringify({ bounds: { x: 'a' } })).bounds).toBeNull();
  });

  it('без сохранённого — размер по умолчанию, место выбирает система', () => {
    expect(initialBounds(parseState(null), [screen])).toEqual(DEFAULT_SIZE);
  });

  it('видимое окно открывается там же', () => {
    const state = parseState(JSON.stringify({ bounds: { x: 100, y: 50, width: 900, height: 700 } }));
    expect(initialBounds(state, [screen])).toEqual({ x: 100, y: 50, width: 900, height: 700 });
  });

  it('окно на отключённом мониторе — тот же размер, но без координат', () => {
    const state = parseState(JSON.stringify({ bounds: { x: 3000, y: 100, width: 900, height: 700 } }));
    expect(initialBounds(state, [screen])).toEqual({ width: 900, height: 700 });
  });
});
