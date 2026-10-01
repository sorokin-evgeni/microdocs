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
  it('на виду — «Вложенная» и «В архив», остальное в меню', () => {
    setup();
    for (const name of ['Добавить вложенную', 'Архивировать', 'Ещё действия']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: 'Переместить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('кнопки на виду вызывают свои действия', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Добавить вложенную' }));
    await user.click(screen.getByRole('button', { name: 'Архивировать' }));

    expect(handlers.onCreateChild).toHaveBeenCalledTimes(1);
    expect(handlers.onArchive).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Переместить…', 'onMove'],
    ['Удалить', 'onDelete'],
  ] as const)('«%s» — из меню за троеточием', async (item, handler) => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Ещё действия' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));

    expect(handlers[handler]).toHaveBeenCalledTimes(1);
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
