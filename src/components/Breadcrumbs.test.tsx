import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { TreeNode } from '../types';
import { Breadcrumbs } from './Breadcrumbs';
import { renderUI } from '../test/render';

const node = (id: string, title: string, icon?: string): TreeNode => ({ id, title, icon, children: [] });
const trail = [node('a', 'Работа'), node('b', 'Проекты', '📁'), node('c', 'Microdocs')];

/** Обе раскладки в разметке; какая видна, решает ширина экрана (CSS). */
const rows = () => {
  const nav = screen.getByRole('navigation', { name: 'Путь к странице' });
  const [desktop, mobile] = nav.querySelectorAll('.page-breadcrumbs-row');
  return { desktop: desktop as HTMLElement, mobile: mobile as HTMLElement };
};

describe('хлебные крошки', () => {
  it('у страницы верхнего уровня их нет', () => {
    renderUI(<Breadcrumbs trail={[]} onOpen={vi.fn()} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('на широком экране — весь путь, с иконками, без самой страницы', () => {
    renderUI(<Breadcrumbs trail={trail} onOpen={vi.fn()} />);
    const crumbs = within(rows().desktop).getAllByRole('button').map((b) => b.textContent);
    expect(crumbs).toEqual(['Работа', '📁 Проекты', 'Microdocs']);
  });

  it('на телефоне — многоточие и прямой родитель', () => {
    renderUI(<Breadcrumbs trail={trail} onOpen={vi.fn()} />);
    const { mobile } = rows();
    expect(within(mobile).getAllByRole('button').map((b) => b.textContent)).toEqual(['Microdocs']);
    expect(within(mobile).getByText('…')).toHaveAttribute('title', 'Работа / 📁 Проекты / Microdocs');
  });

  it('на телефоне с одним предком многоточия нет', () => {
    renderUI(<Breadcrumbs trail={[node('a', 'Работа')]} onOpen={vi.fn()} />);
    expect(within(rows().mobile).queryByText('…')).toBeNull();
  });

  it('щелчок по звену открывает эту страницу', () => {
    const onOpen = vi.fn();
    renderUI(<Breadcrumbs trail={trail} onOpen={onOpen} />);
    fireEvent.click(within(rows().desktop).getByRole('button', { name: '📁 Проекты' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
});
