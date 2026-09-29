import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from './editorSetup';

const PAGE = '[Билеты](microdocs:page/6c55bbc7-0ee5-4667-af33-bb8a02be42ba)';
const ASSET = '[Ticket.pdf](microdocs:asset/buildin/5f5480991b6d/Ticket.pdf)';
const EXTERNAL = '[сайт](https://example.com)';
const BODY = [`Страница: ${PAGE}`, `Файл: ${ASSET}`, `Внешняя: ${EXTERNAL}`].join('\n\n');

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(body: string) {
  editor = new Editor({ extensions: editorExtensions(), content: body });
  return editor;
}

const markdownOf = (e: Editor) =>
  (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

describe('ссылки в редакторе', () => {
  it('показывает внутренние ссылки ссылками, а не текстом', () => {
    const html = open(BODY).getHTML();
    expect(html).toContain('href="microdocs:page/6c55bbc7-0ee5-4667-af33-bb8a02be42ba"');
    expect(html).toContain('href="microdocs:asset/buildin/5f5480991b6d/Ticket.pdf"');
    expect(html).toContain('href="https://example.com"');
  });

  it('не теряет адреса ссылок после правки страницы', () => {
    const e = open(BODY);
    e.commands.insertContentAt(e.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'правка' }] });

    const saved = markdownOf(e);
    expect(saved).toContain(PAGE);
    expect(saved).toContain(ASSET);
    expect(saved).toContain(EXTERNAL);
    expect(saved).toContain('правка');
  });

  it('по-прежнему не пускает javascript: в ссылки', () => {
    const html = open('[x](javascript:alert(1))').getHTML();
    expect(html).not.toContain('<a');
  });
});
