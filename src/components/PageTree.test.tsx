import { describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, screen } from '@testing-library/react';
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
  onArchive: vi.fn(),
  onMoveRequest: vi.fn(),
  onShift: vi.fn(),
  onPlace: vi.fn(),
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

  it('показывает иконку перед названием', () => {
    const withIcon: Tree = { roots: [{ id: 'x', title: 'Идеи', icon: '💡', children: [] }] };
    renderUI(<PageTree tree={withIcon} selectedId="x" {...setupHandlers()} />);
    expect(screen.getByRole('button', { name: /^💡\s*Идеи$/ })).toBeInTheDocument();
  });

  it('без иконки ставит на её место листочек, не меняя имя кнопки', () => {
    const plain: Tree = { roots: [{ id: 'x', title: 'Идеи', children: [] }] };
    renderUI(<PageTree tree={plain} selectedId="x" {...setupHandlers()} />);
    const button = screen.getByRole('button', { name: 'Идеи' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
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

  it('запрашивает архивирование страницы', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Архивировать'));
    expect(handlers.onArchive).toHaveBeenCalledWith('c');
  });

  it('запрашивает удаление страницы', async () => {
    const { handlers, user } = setup();
    await openMenu(user, 'Вторая');
    await user.click(screen.getByText('Удалить'));
    expect(handlers.onDelete).toHaveBeenCalledWith('c');
  });
});

describe('перетаскивание', () => {
  /** jsdom не раскладывает страницу — высоту строки задаём сами. */
  function row(title: string) {
    const element = screen.getByText(title).closest<HTMLElement>('[data-page-id]');
    if (!element) throw new Error(`Нет строки «${title}»`);
    element.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 40, width: 200 });
    return element;
  }

  /** Тащит строку на другую; y — где отпустили, от верха строки высотой 40. */
  function drag(from: string, to: string, y: number) {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(row(from), { dataTransfer });
    // В jsdom нет DragEvent, и координату из параметров событие не берёт.
    const over = createEvent.dragOver(row(to), { dataTransfer });
    Object.defineProperty(over, 'clientY', { value: y });
    const allowed = !fireEvent(row(to), over);
    fireEvent.drop(row(to), { dataTransfer });
    return allowed;
  }

  it('на середину строки — вкладывает', () => {
    const { handlers } = setup();
    drag('Вторая', 'Вложенная', 20);
    expect(handlers.onPlace).toHaveBeenCalledWith('c', 'b', 'inside');
  });

  it('на верх строки — ставит перед ней', () => {
    const { handlers } = setup();
    drag('Вторая', 'Первая', 5);
    expect(handlers.onPlace).toHaveBeenCalledWith('c', 'a', 'before');
  });

  it('на низ строки — ставит после неё', () => {
    const { handlers } = setup();
    drag('Вторая', 'Вложенная', 35);
    expect(handlers.onPlace).toHaveBeenCalledWith('c', 'b', 'after');
  });

  it('низ раскрытой ветки — внутрь: под ней уже идут её дети', () => {
    const { handlers } = setup();
    drag('Вторая', 'Первая', 35);
    expect(handlers.onPlace).toHaveBeenCalledWith('c', 'a', 'inside');
  });

  it('не даёт бросить страницу в её же поддерево (FR-9)', () => {
    const { handlers } = setup();
    expect(drag('Первая', 'Вложенная', 20)).toBe(false);
    expect(drag('Первая', 'Первая', 20)).toBe(false);
    expect(handlers.onPlace).not.toHaveBeenCalled();
  });
});
