import { describe, expect, it } from 'vitest';
import { escapePipes } from './markdownTable';

describe('черта в ячейке', () => {
  it('экранируется, если ещё не экранирована', () => {
    expect(escapePipes('a|b')).toBe('a\\|b');
    expect(escapePipes('a\\|b')).toBe('a\\|b');
  });

  it('после экранированной обратной косой — снова разделитель, её экранируем', () => {
    expect(escapePipes('a\\\\|b')).toBe('a\\\\\\|b');
  });
});
