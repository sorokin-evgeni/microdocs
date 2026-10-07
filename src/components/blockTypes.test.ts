import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from './editorSetup';
import {
  BLOCK_TYPES,
  blockAt,
  blockTypeOf,
  deleteBlock,
  duplicateBlock,
  filterBlockTypes,
  insertBelow,
  turnInto,
} from './blockTypes';
import { SlashController } from './slashCommand';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(body: string, slash?: SlashController) {
  // С элементом: слэш-меню живёт в представлении редактора, без него не включается.
  editor = new Editor({ element: document.createElement('div'), extensions: editorExtensions(slash), content: body });
  return editor;
}

const markdownOf = (e: Editor) =>
  (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
/** Список слэш-меню подбирается асинхронно — даём ему отработать. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * Нажатие клавиши, как от браузера. keyboardShortcut тут не годится: он
 * перехватывает транзакцию и сам применяет её шаги, а выбор в слэш-меню
 * пишет свою — она применялась бы дважды.
 */
const press = (e: Editor, key: string) =>
  e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const type = (id: string) => BLOCK_TYPES.find((t) => t.id === id)!;

/** Позиция внутри текста `needle` (сразу после его начала + offset). */
function posOf(e: Editor, needle: string, offset = 0): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.text?.includes(needle)) found = pos + node.text.indexOf(needle) + offset;
  });
  if (found < 0) throw new Error(`нет «${needle}»`);
  return found;
}

describe('Enter и Backspace', () => {
  it('Enter в конце заголовка начинает обычный текст', () => {
    const e = open('# Заголовок');
    e.commands.setTextSelection(posOf(e, 'Заголовок', 'Заголовок'.length));
    e.commands.keyboardShortcut('Enter');
    e.commands.insertContent('дальше');
    expect(markdownOf(e)).toBe('# Заголовок\n\nдальше');
  });

  it('Backspace в начале заголовка делает его текстом, а не склеивает с предыдущей строкой', () => {
    const e = open('выше\n\n## Заголовок');
    e.commands.setTextSelection(posOf(e, 'Заголовок'));
    e.commands.keyboardShortcut('Backspace');
    expect(markdownOf(e)).toBe('выше\n\nЗаголовок');
    e.commands.keyboardShortcut('Backspace');
    expect(markdownOf(e)).toBe('вышеЗаголовок');
  });

  it('Backspace в начале пункта списка выносит его из списка', () => {
    const e = open('- один\n- два');
    e.commands.setTextSelection(posOf(e, 'два'));
    e.commands.keyboardShortcut('Backspace');
    expect(markdownOf(e)).toBe('- один\n\nдва');
  });

  it('Backspace в начале цитаты снимает цитату', () => {
    const e = open('> мысль');
    e.commands.setTextSelection(posOf(e, 'мысль'));
    e.commands.keyboardShortcut('Backspace');
    expect(markdownOf(e)).toBe('мысль');
  });

  it('Backspace в середине заголовка его не трогает — стирает браузер', () => {
    const e = open('# Заголовок');
    e.commands.setTextSelection(posOf(e, 'Заголовок', 3));
    e.commands.keyboardShortcut('Backspace');
    expect(markdownOf(e)).toBe('# Заголовок');
  });
});

describe('ручка блока', () => {
  it('находит блок верхнего уровня, а в списке — пункт', () => {
    const e = open('# Заголовок\n\n- один\n- два\n\nтекст');
    expect(blockAt(e.state.doc, posOf(e, 'Заголовок'))!.node.type.name).toBe('heading');
    const item = blockAt(e.state.doc, posOf(e, 'два'))!;
    expect(item.node.type.name).toBe('listItem');
    expect(item.node.textContent).toBe('два');
    expect(blockTypeOf(e.state.doc, item)).toBe('bulletList');
    expect(blockTypeOf(e.state.doc, blockAt(e.state.doc, posOf(e, 'текст'))!)).toBe('paragraph');
  });

  it('превращает заголовок в текст и обратно', () => {
    const e = open('# Заголовок\n\nтекст');
    turnInto(e, blockAt(e.state.doc, posOf(e, 'Заголовок'))!, type('paragraph'));
    expect(markdownOf(e)).toBe('Заголовок\n\nтекст');
    turnInto(e, blockAt(e.state.doc, posOf(e, 'текст'))!, type('h2'));
    expect(markdownOf(e)).toBe('Заголовок\n\n## текст');
  });

  it('превращает пункт списка в заголовок, не трогая соседние', () => {
    const e = open('- один\n- два\n- три');
    turnInto(e, blockAt(e.state.doc, posOf(e, 'два'))!, type('h1'));
    expect(markdownOf(e)).toBe('- один\n\n# два\n\n- три');
  });

  it('превращает текст в списки, цитату, код и чек-лист', () => {
    for (const [id, md] of <[string, string][]>[
      ['bulletList', '- строка'],
      ['orderedList', '1. строка'],
      ['blockquote', '> строка'],
      ['codeBlock', '```\nстрока\n```'],
      ['taskList', '- [ ] строка'],
    ]) {
      const e = open('строка');
      turnInto(e, blockAt(e.state.doc, posOf(e, 'строка'))!, type(id));
      expect(markdownOf(e)).toBe(md);
      e.destroy();
    }
  });

  it('дублирует и удаляет блок', () => {
    const e = open('# А\n\nБ');
    duplicateBlock(e, blockAt(e.state.doc, posOf(e, 'А'))!);
    expect(markdownOf(e)).toBe('# А\n\n# А\n\nБ');
    deleteBlock(e, blockAt(e.state.doc, posOf(e, 'Б'))!);
    expect(markdownOf(e)).toBe('# А\n\n# А');
  });

  it('«+» вставляет строку с «/» под блоком и открывает слэш-меню', async () => {
    const slash = new SlashController();
    const e = open('# А\n\nБ', slash);
    insertBelow(e, blockAt(e.state.doc, posOf(e, 'А'))!);
    await settle();
    expect(markdownOf(e)).toBe('# А\n\n/\n\nБ');
    expect(slash.get()?.items.length).toBe(BLOCK_TYPES.length);
  });
});

describe('слэш-меню', () => {
  it('ищет по названию, английскому слову и Markdown', () => {
    expect(filterBlockTypes('заг').map((t) => t.id)).toEqual(['h1', 'h2', 'h3']);
    expect(filterBlockTypes('h2').map((t) => t.id)).toEqual(['h2']);
    expect(filterBlockTypes('спис').map((t) => t.id)).toEqual(['bulletList', 'orderedList']);
    expect(filterBlockTypes('todo').map((t) => t.id)).toEqual(['taskList']);
    expect(filterBlockTypes('чек').map((t) => t.id)).toEqual(['taskList']);
    expect(filterBlockTypes('ыыы')).toEqual([]);
  });

  it('«/заг» + Enter превращает строку в заголовок и стирает команду', async () => {
    const slash = new SlashController();
    const e = open('', slash);
    e.commands.insertContent('/заг');
    await settle();
    expect(slash.get()?.items.map((t) => t.id)).toEqual(['h1', 'h2', 'h3']);
    press(e, 'ArrowDown');
    expect(slash.get()?.selected).toBe(1);
    press(e, 'Enter');
    await settle();
    expect(slash.get()).toBeNull();
    e.commands.insertContent('Раздел');
    expect(markdownOf(e)).toBe('## Раздел');
  });

  it('Esc закрывает меню, Enter после — обычный перенос', async () => {
    const slash = new SlashController();
    const e = open('', slash);
    e.commands.insertContent('/код');
    await settle();
    expect(slash.get()).not.toBeNull();
    press(e, 'Escape');
    await settle();
    expect(slash.get()).toBeNull();
    press(e, 'Enter');
    expect(e.state.doc.childCount).toBe(2);
    expect(markdownOf(e)).toBe('/код');
  });

  it('не открывается посреди слова и в коде', async () => {
    const slash = new SlashController();
    const e = open('', slash);
    e.commands.insertContent('и/или');
    await settle();
    expect(slash.get()).toBeNull();
    e.commands.setContent('```\nx\n```');
    e.commands.setTextSelection(posOf(e, 'x', 1));
    e.commands.insertContent(' /');
    await settle();
    expect(slash.get()).toBeNull();
  });
});

describe('чек-лист в Markdown', () => {
  it('список, где галочки только у части пунктов, остаётся обычным', () => {
    const e = open('- один\n- [ ] задача\n- [x] готово');
    expect(e.getHTML()).not.toContain('taskList');
    expect(e.state.doc.textContent).toBe('один[ ] задача[x] готово');
  });

  it('читается и пишется как «- [ ]» и «- [x]»', () => {
    const e = open('- [ ] купить\n- [x] сделано');
    expect(e.getHTML()).toContain('data-type="taskList"');
    expect(markdownOf(e)).toBe('- [ ] купить\n- [x] сделано');
  });
});
