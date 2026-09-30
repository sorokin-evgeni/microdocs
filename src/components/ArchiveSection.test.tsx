import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArchivedNode } from '../types';
import { ArchiveSection } from './ArchiveSection';
import { renderUI } from '../test/render';

const archive: ArchivedNode[] = [
  { node: { id: 'a', title: 'Старое', children: [] }, parentId: null, index: 0 },
  { node: { id: 'b', title: '', icon: '📦', children: [] }, parentId: 'x', index: 2 },
];

function setup(entries = archive) {
  const handlers = { onRestore: vi.fn(), onDelete: vi.fn() };
  renderUI(<ArchiveSection archive={entries} {...handlers} />);
  return { handlers, user: userEvent.setup() };
}

describe('архив', () => {
  it('пустой не показывается', () => {
    setup([]);
    expect(screen.queryByText(/Архив/)).not.toBeInTheDocument();
  });

  it('свёрнут, пока не откроешь; свежие сверху', async () => {
    const { user } = setup();
    expect(screen.queryByText('Старое')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Архив · 2/ }));
    const restore = screen.getAllByRole('button', { name: /^Восстановить/ });
    expect(restore.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Восстановить: Без названия',
      'Восстановить: Старое',
    ]);
  });

  it('восстанавливает и удаляет насовсем', async () => {
    const { handlers, user } = setup();
    await user.click(screen.getByRole('button', { name: /Архив/ }));

    await user.click(screen.getByRole('button', { name: 'Восстановить: Старое' }));
    expect(handlers.onRestore).toHaveBeenCalledWith('a');

    await user.click(screen.getByRole('button', { name: 'Удалить насовсем: Старое' }));
    expect(handlers.onDelete).toHaveBeenCalledWith('a');
  });
});
