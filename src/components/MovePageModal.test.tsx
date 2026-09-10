import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Tree } from '../types';
import { MovePageModal } from './MovePageModal';
import { renderUI } from '../test/render';

/**
 *  Первая
 *  └─ Вложенная
 *     └─ Глубокая
 *  Вторая
 */
const tree: Tree = {
  roots: [
    {
      id: 'a',
      title: 'Первая',
      children: [
        {
          id: 'b',
          title: 'Вложенная',
          children: [{ id: 'c', title: 'Глубокая', children: [] }],
        },
      ],
    },
    { id: 'd', title: 'Вторая', children: [] },
  ],
};

function setup(pageId: string | null) {
  const onMove = vi.fn();
  const onClose = vi.fn();
  renderUI(
    <MovePageModal
      tree={tree}
      pageId={pageId}
      onClose={onClose}
      onMove={onMove}
    />,
  );
  return { onMove, onClose, user: userEvent.setup() };
}

describe('перенос страницы', () => {
  it('закрытая модалка ничего не показывает', () => {
    setup(null);
    expect(screen.queryByText('На верхний уровень')).not.toBeInTheDocument();
  });

  it('не предлагает страницу саму себе и её потомков (FR-9)', async () => {
    setup('a');
    await screen.findByText('На верхний уровень');

    expect(screen.queryByText('Первая')).not.toBeInTheDocument();
    expect(screen.queryByText('Вложенная')).not.toBeInTheDocument();
    expect(screen.queryByText('Глубокая')).not.toBeInTheDocument();
    expect(screen.getByText('Вторая')).toBeInTheDocument();
  });

  it('предлагает всех допустимых родителей', async () => {
    setup('d');
    await screen.findByText('На верхний уровень');

    expect(screen.getByText('Первая')).toBeInTheDocument();
    expect(screen.getByText('Вложенная')).toBeInTheDocument();
    expect(screen.getByText('Глубокая')).toBeInTheDocument();
    expect(screen.queryByText('Вторая')).not.toBeInTheDocument();
  });

  it('сообщает выбранного родителя', async () => {
    const { onMove, user } = setup('d');
    await user.click(await screen.findByText('Вложенная'));
    expect(onMove).toHaveBeenCalledWith('b');
  });

  it('умеет вынести на верхний уровень', async () => {
    const { onMove, user } = setup('c');
    await user.click(await screen.findByText('На верхний уровень'));
    expect(onMove).toHaveBeenCalledWith(null);
  });
});
