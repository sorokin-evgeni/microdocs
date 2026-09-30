import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PageId, Tree } from '../types';
import { PageTree } from './PageTree';
import { MovePageModal } from './MovePageModal';
import { renderUI } from '../test/render';
import { moveNode } from '../domain/tree';

const initial: Tree = {
  roots: [
    {
      id: 'a',
      title: 'Первая',
      children: [{ id: 'b', title: 'Вложенная', children: [] }],
    },
    { id: 'c', title: 'Вторая', children: [] },
  ],
};

/**
 * Повторяет связку из App: дерево запрашивает перенос, состояние поднимается
 * наверх, модалка открывается по непустому идентификатору.
 */
function MoveFlow({ onMoved }: { onMoved: (tree: Tree) => void }) {
  const [tree, setTree] = useState(initial);
  const [movingId, setMovingId] = useState<PageId | null>(null);

  return (
    <>
      <PageTree
        tree={tree}
        selectedId={null}
        onSelect={vi.fn()}
        onCreateChild={vi.fn()}
        onDelete={vi.fn()}
        onMoveRequest={setMovingId}
        onShift={vi.fn()}
        onPlace={vi.fn()}
      />
      <MovePageModal
        tree={tree}
        pageId={movingId}
        onClose={() => setMovingId(null)}
        onMove={(newParentId) => {
          if (movingId) {
            const next = moveNode(tree, movingId, newParentId);
            setTree(next);
            onMoved(next);
          }
          setMovingId(null);
        }}
      />
    </>
  );
}

describe('сценарий переноса целиком', () => {
  it('пункт меню открывает окно выбора родителя', async () => {
    const user = userEvent.setup();
    renderUI(<MoveFlow onMoved={vi.fn()} />);

    expect(screen.queryByText('На верхний уровень')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Действия: Вторая' }));
    await user.click(await screen.findByText('Переместить…'));

    expect(await screen.findByText('На верхний уровень')).toBeInTheDocument();
  });

  it('выбор родителя действительно переносит страницу', async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    renderUI(<MoveFlow onMoved={onMoved} />);

    await user.click(screen.getByRole('button', { name: 'Действия: Вторая' }));
    await user.click(await screen.findByText('Переместить…'));

    // «Вложенная» есть и в дереве, и в списке целей — ищем внутри окна.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Вложенная'));

    const next: Tree = onMoved.mock.calls[0]?.[0];
    expect(next.roots.map((n) => n.id)).toEqual(['a']);
    expect(next.roots[0]?.children[0]?.children.map((n) => n.id)).toEqual(['c']);
  });
});
