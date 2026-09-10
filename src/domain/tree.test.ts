import { describe, expect, it } from 'vitest';
import type { Tree } from '../types';
import {
  canMove,
  findNode,
  insertNode,
  makeNode,
  moveNode,
  removeNode,
  renameNode,
  shiftNode,
  subtreeIds,
} from './tree';

/**
 *  a
 *  ├─ b
 *  │  └─ c
 *  └─ d
 *  e
 */
function fixture(): Tree {
  return {
    roots: [
      {
        id: 'a',
        title: 'A',
        children: [
          { id: 'b', title: 'B', children: [{ id: 'c', title: 'C', children: [] }] },
          { id: 'd', title: 'D', children: [] },
        ],
      },
      { id: 'e', title: 'E', children: [] },
    ],
  };
}

const titlesOfRoots = (tree: Tree) => tree.roots.map((n) => n.id);
const childIds = (tree: Tree, id: string) =>
  findNode(tree, id)?.children.map((n) => n.id) ?? [];

describe('поиск', () => {
  it('находит узел на любой глубине', () => {
    expect(findNode(fixture(), 'c')?.title).toBe('C');
  });

  it('возвращает null для несуществующего узла', () => {
    expect(findNode(fixture(), 'нет')).toBeNull();
  });

  it('собирает идентификаторы поддерева вместе с корнем', () => {
    const a = findNode(fixture(), 'a');
    expect(a && subtreeIds(a)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('добавление', () => {
  it('добавляет страницу в конец верхнего уровня', () => {
    const tree = insertNode(fixture(), null, makeNode('Ф', 'f'));
    expect(titlesOfRoots(tree)).toEqual(['a', 'e', 'f']);
  });

  it('добавляет страницу последним ребёнком (FR-7)', () => {
    const tree = insertNode(fixture(), 'a', makeNode('Ф', 'f'));
    expect(childIds(tree, 'a')).toEqual(['b', 'd', 'f']);
  });

  it('падает, если родителя нет', () => {
    expect(() => insertNode(fixture(), 'нет', makeNode('Ф', 'f'))).toThrow();
  });

  it('не мутирует исходное дерево', () => {
    const original = fixture();
    insertNode(original, 'a', makeNode('Ф', 'f'));
    expect(childIds(original, 'a')).toEqual(['b', 'd']);
  });
});

describe('переименование', () => {
  it('меняет заголовок только нужного узла', () => {
    const tree = renameNode(fixture(), 'c', 'Новое');
    expect(findNode(tree, 'c')?.title).toBe('Новое');
    expect(findNode(tree, 'b')?.title).toBe('B');
  });
});

describe('удаление', () => {
  it('убирает узел вместе с поддеревом и возвращает его идентификаторы', () => {
    const { tree, removed } = removeNode(fixture(), 'b');
    expect(removed).toEqual(['b', 'c']);
    expect(childIds(tree, 'a')).toEqual(['d']);
    expect(findNode(tree, 'c')).toBeNull();
  });

  it('на несуществующем узле ничего не меняет', () => {
    const { tree, removed } = removeNode(fixture(), 'нет');
    expect(removed).toEqual([]);
    expect(titlesOfRoots(tree)).toEqual(['a', 'e']);
  });
});

describe('перенос', () => {
  it('запрещает перенос внутрь собственного поддерева (FR-9)', () => {
    expect(canMove(fixture(), 'a', 'c')).toBe(false);
    expect(() => moveNode(fixture(), 'a', 'c')).toThrow();
  });

  it('запрещает перенос в самого себя', () => {
    expect(canMove(fixture(), 'b', 'b')).toBe(false);
  });

  it('разрешает перенос на верхний уровень', () => {
    expect(canMove(fixture(), 'c', null)).toBe(true);
    const tree = moveNode(fixture(), 'c', null);
    expect(titlesOfRoots(tree)).toEqual(['a', 'e', 'c']);
    expect(childIds(tree, 'b')).toEqual([]);
  });

  it('переносит узел вместе с поддеревом', () => {
    const tree = moveNode(fixture(), 'b', 'e');
    expect(childIds(tree, 'e')).toEqual(['b']);
    expect(childIds(tree, 'b')).toEqual(['c']);
    expect(childIds(tree, 'a')).toEqual(['d']);
  });

  it('запрещает перенос под несуществующего родителя', () => {
    expect(canMove(fixture(), 'b', 'нет')).toBe(false);
  });
});

describe('порядок среди соседей', () => {
  it('двигает вниз', () => {
    const tree = shiftNode(fixture(), 'a', 1);
    expect(titlesOfRoots(tree)).toEqual(['e', 'a']);
  });

  it('двигает вверх', () => {
    const tree = shiftNode(fixture(), 'e', -1);
    expect(titlesOfRoots(tree)).toEqual(['e', 'a']);
  });

  it('на границе списка ничего не делает', () => {
    expect(titlesOfRoots(shiftNode(fixture(), 'a', -1))).toEqual(['a', 'e']);
    expect(titlesOfRoots(shiftNode(fixture(), 'e', 1))).toEqual(['a', 'e']);
  });

  it('работает на вложенном уровне', () => {
    const tree = shiftNode(fixture(), 'd', -1);
    expect(childIds(tree, 'a')).toEqual(['d', 'b']);
  });

  it('не мутирует исходное дерево', () => {
    const original = fixture();
    shiftNode(original, 'a', 1);
    expect(titlesOfRoots(original)).toEqual(['a', 'e']);
  });
});
