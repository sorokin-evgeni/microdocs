import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Editor, type EditorHandle } from './Editor';
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

describe('Enter в заголовке', () => {
  function mount(body: string) {
    const handle = createRef<EditorHandle>();
    const onChange = vi.fn();
    renderUI(<Editor pageId="x" body={body} onChange={onChange} onOpenPage={vi.fn()} handle={handle} />);
    return { handle, onChange };
  }

  it('добавляет пустую строку в начало и ставит в неё курсор', async () => {
    const { handle } = mount('Первый абзац\n\nВторой');
    await screen.findByText('Первый абзац');
    handle.current!.startNewLine();
    const paragraphs = document.querySelectorAll('.ProseMirror > p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]!.textContent).toBe('');
    expect(paragraphs[1]!.textContent).toBe('Первый абзац');
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.ProseMirror')));
  });

  it('не плодит пустые строки, если первая уже пустая', async () => {
    const { handle } = mount('');
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
    handle.current!.startNewLine();
    handle.current!.startNewLine();
    expect(document.querySelectorAll('.ProseMirror > p')).toHaveLength(1);
  });
});
