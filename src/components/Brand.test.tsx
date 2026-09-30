import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Brand } from './Brand';
import { renderUI } from '../test/render';

describe('логотип', () => {
  it('ведёт на корень', () => {
    renderUI(<Brand onOpenRoot={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'microdocs' })).toHaveAttribute('href', '/');
  });

  it('обычный щелчок открывает корень без перезагрузки', () => {
    const onOpenRoot = vi.fn();
    renderUI(<Brand onOpenRoot={onOpenRoot} />);
    const followed = fireEvent.click(screen.getByRole('link', { name: 'microdocs' }));
    expect(onOpenRoot).toHaveBeenCalledOnce();
    expect(followed).toBe(false);
  });

  it('щелчок с Ctrl или Cmd оставляет браузеру — откроется новая вкладка', () => {
    const onOpenRoot = vi.fn();
    renderUI(<Brand onOpenRoot={onOpenRoot} />);
    const link = screen.getByRole('link', { name: 'microdocs' });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(onOpenRoot).not.toHaveBeenCalled();
  });
});
