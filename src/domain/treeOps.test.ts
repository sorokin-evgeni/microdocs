import { describe, expect, it } from 'vitest';
import type { Tree } from '../types';
import { archiveNode, findNode, removeNode } from './tree';
import { applyOp, applyOps, type TreeOp } from './treeOps';

/**
 *  a
 *  └─ b
 *  c
 */
const tree: Tree = {
  roots: [
    { id: 'a', title: 'A', children: [{ id: 'b', title: 'B', children: [] }] },
    { id: 'c', title: 'C', children: [] },
  ],
};

const titles = (t: Tree): unknown =>
  t.roots.map((n) => (n.children.length ? [n.title, titles({ roots: n.children })] : n.title));

describe('операции над деревом', () => {
  it('применяются так же, как функции дерева', () => {
    const next = applyOps(tree, [
      { type: 'create', parentId: 'c', node: { id: 'd', title: 'D', children: [] } },
      { type: 'rename', id: 'b', title: 'B2' },
      { type: 'move', id: 'b', parentId: null },
      { type: 'shift', id: 'b', delta: -1 },
    ]);
    expect(titles(next)).toEqual(['A', 'B2', ['C', ['D']]]);
  });
});

describe('операции поверх дерева, которое поменяли на другом устройстве', () => {
  it('правка удалённой там страницы ничего не делает', () => {
    const elsewhere = removeNode(tree, 'b').tree;
    for (const op of [
      { type: 'rename', id: 'b', title: 'X' },
      { type: 'setIcon', id: 'b', icon: '🙂' },
      { type: 'remove', id: 'b' },
      { type: 'archive', id: 'b' },
      { type: 'shift', id: 'b', delta: 1 },
      { type: 'move', id: 'b', parentId: 'c' },
      { type: 'place', id: 'b', targetId: 'c', position: 'before' },
    ] as const) {
      expect(applyOp(elsewhere, op), op.type).toEqual(elsewhere);
    }
  });

  it('новая страница под удалённым там родителем встаёт на верхний уровень', () => {
    const elsewhere = removeNode(tree, 'a').tree;
    const next = applyOp(elsewhere, {
      type: 'create',
      parentId: 'b',
      node: { id: 'n', title: 'Новая', children: [] },
    });
    expect(titles(next)).toEqual(['C', 'Новая']);
  });

  it('перенос к исчезнувшей странице не делается', () => {
    const elsewhere = removeNode(tree, 'c').tree;
    expect(applyOp(elsewhere, { type: 'move', id: 'b', parentId: 'c' })).toEqual(elsewhere);
    expect(
      applyOp(elsewhere, { type: 'place', id: 'b', targetId: 'c', position: 'after' }),
    ).toEqual(elsewhere);
  });

  it('перенос, который теперь дал бы цикл, не делается', () => {
    // Там c перенесли внутрь b; здесь b переносили внутрь c.
    const elsewhere = applyOp(tree, { type: 'move', id: 'c', parentId: 'b' });
    expect(applyOp(elsewhere, { type: 'move', id: 'b', parentId: 'c' })).toEqual(elsewhere);
  });

  it('переименование доходит до ветки, которую там убрали в архив', () => {
    const elsewhere = archiveNode(tree, 'a');
    const next = applyOp(elsewhere, { type: 'rename', id: 'b', title: 'B2' });
    expect(next.archive?.[0]?.node.children[0]?.title).toBe('B2');
    expect(findNode(next, 'b')).toBeNull();
  });

  it('создание страницы, которая уже есть, не дублирует её', () => {
    const op: TreeOp = { type: 'create', parentId: null, node: { id: 'c', title: 'C', children: [] } };
    expect(applyOp(tree, op)).toEqual(tree);
  });

  it('правки в разных местах складываются', () => {
    const elsewhere = applyOp(tree, { type: 'rename', id: 'a', title: 'A с другого' });
    const next = applyOps(elsewhere, [
      { type: 'rename', id: 'c', title: 'C отсюда' },
      { type: 'create', parentId: 'a', node: { id: 'n', title: 'N', children: [] } },
    ]);
    expect(titles(next)).toEqual([['A с другого', ['B', 'N']], 'C отсюда']);
  });
});
