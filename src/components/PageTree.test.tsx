import { describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
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

const setupHandlers = () => ({
  onSelect: vi.fn(),
  onCreateChild: vi.fn(),
  onDelete: vi.fn(),
  onMoveRequest: vi.fn(),
  onShift: vi.fn(),
});

function setup() {
  const handlers = setupHandlers();
  const { rerenderUI } = renderUI(<PageTree tree={tree} selectedId="a" {...handlers} />);
  // Выбор извне дерева — так он приходит при переходе по ссылке.
  const select = (id: string) => rerenderUI(<PageTree tree={tree} selectedId={id} {...handlers} />);
  return { handlers, select, user: userEvent.setup() };
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

  it('раскрывает свёрнутую ветку, когда в ней выбрали страницу', async () => {
    const { select, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Свернуть: Первая' }));
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();

    select('b');
    expect(screen.getByText('Вложенная')).toBeInTheDocument();
  });

  it('свёрнутые ветки переживают перезагрузку', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Свернуть: Первая' }));
    cleanup();

    setup();
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Развернуть: Первая' })).toBeInTheDocument();
  });

  it('после перезагрузки не раскрывает свёрнутую ветку с текущей страницей', async () => {
    const { select, user } = setup();
    select('b');
    await user.click(screen.getByRole('button', { name: 'Свернуть: Первая' }));
    cleanup();

    renderUI(<PageTree tree={tree} selectedId="b" {...setupHandlers()} />);
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();
  });

  it('испорченное хранилище — дерево просто раскрыто', () => {
    window.localStorage.setItem('microdocs:collapsed-pages', '{не json');
    setup();
    expect(screen.getByText('Вложенная')).toBeInTheDocument();
  });

  it('даёт свернуть ветку с текущей страницей', async () => {
    const { select, user } = setup();
    select('b');
    await user.click(screen.getByRole('button', { name: 'Свернуть: Первая' }));
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();
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
