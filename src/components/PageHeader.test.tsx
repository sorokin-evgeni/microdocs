import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from './PageHeader';
import { renderUI } from '../test/render';

beforeEach(() => {
  // Выбор эмодзи грузит словарь с сервера; здесь проверяем кнопки, не словарь.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});

function setup(icon?: string) {
  const handlers = {
    onRename: vi.fn(),
    onIconChange: vi.fn(),
    onCreateChild: vi.fn(),
    onMove: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
  };
  renderUI(<PageHeader title="Заметки" icon={icon} {...handlers} />);
  return handlers;
}

describe('PageHeader', () => {
  it('действия видны сразу, без меню', () => {
    setup();
    for (const name of ['Добавить вложенную', 'Переместить', 'Архивировать', 'Удалить']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
  });

  it('каждая кнопка вызывает своё действие', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Добавить вложенную' }));
    await user.click(screen.getByRole('button', { name: 'Переместить' }));
    await user.click(screen.getByRole('button', { name: 'Архивировать' }));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(handlers.onCreateChild).toHaveBeenCalledTimes(1);
    expect(handlers.onMove).toHaveBeenCalledTimes(1);
    expect(handlers.onArchive).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('правка названия уходит наверх', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.type(screen.getByLabelText('Заголовок страницы'), '!');
    expect(handlers.onRename).toHaveBeenLastCalledWith('Заметки!');
  });

  it('без иконки — кнопка «Добавить иконку» открывает выбор с поиском', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Добавить иконку' }));
    expect(await screen.findByPlaceholderText('Поиск')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать иконку' })).not.toBeInTheDocument();
  });

  it('иконку показывает над названием и даёт убрать', async () => {
    const user = userEvent.setup();
    const handlers = setup('🚀');

    await user.click(screen.getByRole('button', { name: 'Сменить иконку' }));
    await user.click(await screen.findByRole('button', { name: 'Убрать иконку' }));
    expect(handlers.onIconChange).toHaveBeenCalledWith(null);
  });
});
