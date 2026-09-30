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

describe('таблицы в редакторе', () => {
  // Настоящие таблицы из базы: пустые ячейки, даты-упоминания, буквальный <br>.
  const FINANCE = ['| Name | Сумма |', '| --- | --- |', '|  | RUB 112,954.00 |', '|  | RUB 106,237.00 |'].join('\n');
  const DIARY = [
    '| Дата | Имя | Related to Еженедельно (Column) |',
    '| --- | --- | --- |',
    '| @January 1, 2020 |  |  |',
    '| @January 2, 2020 |  |  |',
  ].join('\n');
  const ROLES = ['| Роль | L1 | L2 |', '| --- | --- | --- |', '| Lead QA | L1<br>ведёт группу | L2<br>стратегия |'].join('\n');

  const edit = (e: Editor) =>
    e.commands.insertContentAt(e.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'правка' }] });

  /** Позиция начала текста в n-й ячейке тела таблицы (не заголовка). */
  function cellTextPos(e: Editor, n = 0): number {
    const found: number[] = [];
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') found.push(pos + 2);
    });
    const pos = found[n];
    if (pos === undefined) throw new Error(`В таблице нет ячейки №${n}`);
    return pos;
  }

  function paste(e: Editor, html: string) {
    const clipboard = document.createElement('div');
    clipboard.innerHTML = html;
    const doc = DOMParser.fromSchema(e.schema).parse(clipboard);
    e.view.dispatch(e.state.tr.replaceWith(0, e.state.doc.content.size, doc.content));
  }

  it('показываются таблицей с заголовком', () => {
    const html = open(FINANCE).getHTML();
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('RUB 112,954.00</p></td>');
  });

  it.each([
    ['расходы', FINANCE],
    ['дневник', DIARY],
  ])('таблица «%s» переживает правку страницы байт в байт', (_name, table) => {
    const e = open(`До\n\n${table}\n\nПосле`);
    edit(e);
    expect(markdownOf(e)).toBe(`До\n\n${table}\n\nПосле\n\nправка`);
  });

  it('буквальный <br> в ячейке переживает правку', () => {
    // tiptap-markdown пишет «<» и «>» в любом тексте как &lt; и &gt; (FR-22 в MVP не
    // выполняется) — байты меняются, а после переоткрытия текст тот же.
    const e = open(ROLES);
    edit(e);
    const reopened = open(markdownOf(e));
    expect(reopened.getHTML()).toBe(open(`${ROLES}\n\nправка`).getHTML());
    expect(reopened.getHTML()).toContain('<p>L1&lt;br&gt;ведёт группу</p>');
  });

  it('черта, набранная в ячейке, не делит её на две', () => {
    const e = open(FINANCE);
    e.view.dispatch(e.state.tr.insertText('a | b', cellTextPos(e)));
    const saved = markdownOf(e);
    expect(saved).toContain('| a \\| b | RUB 112,954.00 |');

    const reopened = open(saved);
    expect(reopened.getHTML()).toContain('<p>a | b</p>');
    expect(markdownOf(reopened)).toBe(saved);
  });

  it('перенос строки в ячейке становится пробелом, таблица цела', () => {
    const e = open(FINANCE);
    const at = cellTextPos(e, 1) + 'RUB'.length;
    e.view.dispatch(e.state.tr.insert(at, e.schema.node('hardBreak')));
    const saved = markdownOf(e);
    expect(saved).not.toContain('[');
    expect(saved).toContain('|  | RUB 112,954.00 |');
  });

  it('Enter не делит ячейку на два абзаца', () => {
    const e = open(FINANCE);
    e.commands.setTextSelection(cellTextPos(e, 1) + 3);
    expect(e.can().splitBlock()).toBe(false);
  });

  it('вставленная таблица с объединёнными ячейками пишется таблицей, а не [table]', () => {
    const e = open('');
    paste(e, '<table><tr><th colspan="2">Заголовок</th></tr><tr><td>a</td><td>b</td></tr></table>');
    expect(markdownOf(e).trimEnd()).toBe(['| Заголовок |  |', '| --- | --- |', '| a | b |'].join('\n'));
  });

  it('таблица без заголовка получает его из первой строки', () => {
    const e = open('');
    paste(e, '<table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(markdownOf(e).trimEnd()).toBe(['| x | y |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
  });

  it('два абзаца во вставленной ячейке не теряют текст', () => {
    const e = open('');
    paste(e, '<table><tr><th>h</th></tr><tr><td><p>первый</p><p>второй</p></td></tr></table>');
    const saved = markdownOf(e);
    expect(saved).not.toContain('[table]');
    expect(saved).toContain('первый');
    expect(saved).toContain('второй');
  });
});
