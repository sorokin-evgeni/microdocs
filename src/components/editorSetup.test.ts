import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';
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

describe('картинки в редакторе', () => {
  const IMAGE = '![Untitled+1.png](microdocs:asset/buildin/587ea74d5568/Untitled+1.png)';

  it('показываются с адреса сервера', () => {
    const html = open(`До\n\n${IMAGE}\n\nПосле`).getHTML();
    expect(html).toContain('<img');
    expect(html).toContain('src="/api/assets/buildin/587ea74d5568/Untitled%2B1.png"');
    expect(html).toContain('alt="Untitled+1.png"');
  });

  it('не теряются и не меняют адрес после правки страницы', () => {
    const e = open(`До\n\n${IMAGE}\n\nПосле`);
    e.commands.insertContentAt(e.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'правка' }] });

    const saved = markdownOf(e);
    expect(saved).toContain(IMAGE);
    expect(saved).toContain('правка');
  });

  it('картинка внутри строки текста не разрывает абзац', () => {
    const e = open(`Схема ${IMAGE} ниже`);
    expect(e.getHTML()).toMatch(/^<p>Схема <img[^>]+> ниже<\/p>$/);
    expect(markdownOf(e)).toBe(`Схема ${IMAGE} ниже`);
  });

  it('кириллица в имени файла показывается рабочим адресом', () => {
    const html = open('![Схема](microdocs:asset/Root_1/Схема.png)').getHTML();
    expect(html).toContain(`src="/api/assets/Root_1/${encodeURIComponent('Схема')}.png"`);
  });

  it('внешняя картинка остаётся как есть', () => {
    const html = open('![x](https://example.com/a.png)').getHTML();
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it('вставленная из редактора картинка сохраняется ссылкой на вложение', () => {
    // Вставка из буфера разбирает HTML правилами схемы — так же, как здесь.
    const e = open('');
    const clipboard = document.createElement('div');
    clipboard.innerHTML = '<p><img src="/api/assets/buildin/5f54/image.png" alt="x"></p>';
    const pasted = DOMParser.fromSchema(e.schema).parse(clipboard);
    e.view.dispatch(e.state.tr.replaceWith(0, e.state.doc.content.size, pasted.content));

    expect(markdownOf(e)).toBe('![x](microdocs:asset/buildin/5f54/image.png)');
  });
});
