import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Tree } from '../types';
import { PageTree } from './PageTree';
import { renderUI } from '../test/render';

const tree: Tree = {
  roots: [
    {
      id: 'a',
      title: 'Первая',
      children: [{ id: 'b', title: 'Вложенная', children: [] }],
    },
    { id: 'c', title: 'Вторая', children: [] },
  ],
};

function setup() {
  const handlers = {
    onSelect: vi.fn(),
    onCreateChild: vi.fn(),
    onDelete: vi.fn(),
    onMoveRequest: vi.fn(),
    onShift: vi.fn(),
  };
  renderUI(<PageTree tree={tree} selectedId="a" {...handlers} />);
  return { handlers, user: userEvent.setup() };
}

/**
 * Открывает меню строки и ждёт появления пунктов.
 * Ищем по тексту: на время анимации Mantine скрывает выпадающий список
 * от дерева доступности, и запрос по роли `menuitem` его не находит.
 */
async function openMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: `Действия: ${title}` }));
  await screen.findByText('Добавить вложенную');
}

describe('дерево страниц', () => {
  it('показывает все страницы, включая вложенные', () => {
    setup();
    expect(screen.getByText('Первая')).toBeInTheDocument();
    expect(screen.getByText('Вложенная')).toBeInTheDocument();
    expect(screen.getByText('Вторая')).toBeInTheDocument();
  });

  it('сообщает о выборе страницы', async () => {
    const { handlers, user } = setup();
    await user.click(screen.getByText('Вторая'));
    expect(handlers.onSelect).toHaveBeenCalledWith('c');
  });

  it('сворачивает и разворачивает ветку (FR-10)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Свернуть: Первая' }));
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Развернуть: Первая' }));
    expect(screen.getByText('Вложенная')).toBeInTheDocument();
  });

  it('запрашивает создание вложенной страницы', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Добавить вложенную'));
    expect(handlers.onCreateChild).toHaveBeenCalledWith('c');
  });

  it('сдвигает страницу вверх и вниз', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Выше'));
    expect(handlers.onShift).toHaveBeenCalledWith('c', -1);

    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Ниже'));
    expect(handlers.onShift).toHaveBeenCalledWith('c', 1);
  });

  it('запрашивает перенос страницы', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Переместить…'));
    expect(handlers.onMoveRequest).toHaveBeenCalledWith('c');
  });

  it('запрашивает удаление страницы', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Удалить'));
    expect(handlers.onDelete).toHaveBeenCalledWith('c');
  });
});
