import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Editor } from './Editor';
import { renderUI } from '../test/render';

const BODY = [
  'Страница: [Билеты](microdocs:page/p1)',
  'Файл: [Ticket.pdf](microdocs:asset/buildin/5f54/Ticket.pdf)',
  'Внешняя: [сайт](https://example.com)',
].join('\n\n');

function setup() {
  const onOpenPage = vi.fn();
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  renderUI(<Editor pageId="x" body={BODY} onChange={vi.fn()} onOpenPage={onOpenPage} />);
  return { onOpenPage, open };
}

afterEach(() => vi.restoreAllMocks());

describe('переход по ссылкам', () => {
  it('ссылка на страницу открывает её внутри приложения', async () => {
    const { onOpenPage, open } = setup();
    fireEvent.click(await screen.findByText('Билеты'));
    expect(onOpenPage).toHaveBeenCalledWith('p1');
    expect(open).not.toHaveBeenCalled();
  });

  it('внешняя ссылка открывается в новой вкладке', async () => {
    const { onOpenPage, open } = setup();
    fireEvent.click(await screen.findByText('сайт'));
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(onOpenPage).not.toHaveBeenCalled();
  });

  it('вложение открывается в новой вкладке с адреса сервера', async () => {
    const { onOpenPage, open } = setup();
    fireEvent.click(await screen.findByText('Ticket.pdf'));
    expect(open).toHaveBeenCalledWith('/api/assets/buildin/5f54/Ticket.pdf', '_blank', 'noopener,noreferrer');
    expect(onOpenPage).not.toHaveBeenCalled();
  });
});
