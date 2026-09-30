import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from './PageHeader';
import { renderUI } from '../test/render';

function setup() {
  const handlers = {
    onRename: vi.fn(),
    onCreateChild: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
  };
  renderUI(<PageHeader title="Заметки" {...handlers} />);
  return handlers;
}

describe('PageHeader', () => {
  it('три действия видны сразу, без меню', () => {
    setup();
    for (const name of ['Добавить вложенную', 'Переместить', 'Удалить']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
  });

  it('каждая кнопка вызывает своё действие', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Добавить вложенную' }));
    await user.click(screen.getByRole('button', { name: 'Переместить' }));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(handlers.onCreateChild).toHaveBeenCalledTimes(1);
    expect(handlers.onMove).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('правка названия уходит наверх', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.type(screen.getByLabelText('Заголовок страницы'), '!');
    expect(handlers.onRename).toHaveBeenLastCalledWith('Заметки!');
  });
});
