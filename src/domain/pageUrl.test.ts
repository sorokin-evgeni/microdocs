import { describe, expect, it } from 'vitest';
import type { Tree, TreeNode } from '../types';
import { pageIdFromPath, pagePath, slugify } from './pageUrl';

const uuid = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';

const page: TreeNode = {
  id: uuid,
  title: 'Заметки о работе',
  children: [{ id: 'child', title: 'Вложенная', children: [] }],
};

const tree: Tree = { roots: [page] };

describe('slugify', () => {
  it('переводит кириллицу в латиницу и склеивает слова дефисами', () => {
    expect(slugify('Заметки о работе')).toBe('zametki-o-rabote');
    expect(slugify('Щука, ёж и Юля!')).toBe('schuka-ezh-i-yulya');
  });

  it('оставляет латиницу и цифры, выкидывает остальное', () => {
    expect(slugify('  React 19: что нового?  ')).toBe('react-19-chto-novogo');
  });

  it('пустое или нечитаемое название — пустая строка', () => {
    expect(slugify('')).toBe('');
    expect(slugify('🙂 —')).toBe('');
  });

  it('длинное название обрезается без хвостового дефиса', () => {
    const slug = slugify('очень '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('pagePath', () => {
  it('название, затем id', () => {
    expect(pagePath(page)).toBe(`/p/zametki-o-rabote-${uuid}`);
  });

  it('без названия — только id', () => {
    expect(pagePath({ id: 'x', title: '', children: [] })).toBe('/p/x');
  });
});

describe('pageIdFromPath', () => {
  it('находит страницу по своему адресу, в том числе вложенную', () => {
    expect(pageIdFromPath(tree, pagePath(page))).toBe(uuid);
    expect(pageIdFromPath(tree, '/p/vlozhennaya-child')).toBe('child');
  });

  it('старое название в адресе не мешает', () => {
    expect(pageIdFromPath(tree, `/p/staroe-nazvanie-${uuid}`)).toBe(uuid);
  });

  it('голый id без названия', () => {
    expect(pageIdFromPath(tree, `/p/${uuid}`)).toBe(uuid);
  });

  it('несуществующая страница и чужие адреса — null', () => {
    expect(pageIdFromPath(tree, '/p/udalennaya-nope')).toBeNull();
    expect(pageIdFromPath(tree, '/')).toBeNull();
    expect(pageIdFromPath(tree, '/something/child')).toBeNull();
  });

  it('не путает id, который лишь хвост другого слова', () => {
    expect(pageIdFromPath(tree, '/p/nochild')).toBeNull();
  });
});
