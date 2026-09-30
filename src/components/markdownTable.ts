import type { Node as PMNode } from '@tiptap/pm/model';

/** То, чем сериализатор пользуется из состояния tiptap-markdown (prosemirror-markdown). */
export interface MarkdownState {
  out: string;
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(parent: PMNode): void;
  esc(text: string): string;
}

/**
 * Таблица всегда пишется GFM-таблицей. Штатный сериализатор tiptap-markdown
 * при `html: false` пишет вместо «неудобной» таблицы строку `[table]`, то есть
 * стирает её, а неудобной она становится от пустяка: объединённые ячейки,
 * заголовок не в первой строке, перенос строки внутри ячейки.
 *
 * Первая строка — заголовок, какой бы она ни была. Объединённые ячейки
 * раскрываются в пустые, короткие строки дополняются до ширины таблицы.
 */
export function serializeTable(state: MarkdownState, table: PMNode) {
  const width = Math.max(1, ...rowsOf(table).map(spanOf));

  rowsOf(table).forEach((row, index) => {
    let written = 0;
    const next = () => state.write(written++ ? ' | ' : '| ');

    row.forEach((cell) => {
      next();
      writeCell(state, cell);
      for (let extra = 1; extra < colspan(cell); extra++) next();
    });
    while (written < width) next();
    state.write(' |');
    state.ensureNewLine();

    if (index === 0) {
      state.write(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
      state.ensureNewLine();
    }
  });
  state.closeBlock(table);
}

/**
 * Содержимое ячейки — в одну строку: Markdown-таблица другого не умеет.
 * Пишем штатно, потом чиним то, что в строке таблицы недопустимо.
 */
function writeCell(state: MarkdownState, cell: PMNode) {
  const start = state.out.length;
  cell.forEach((block, _offset, index) => {
    if (index) state.write(' ');
    if (block.isTextblock) state.renderInline(block);
    else state.write(state.esc(block.textContent));
  });
  state.out = state.out.slice(0, start) + oneLine(state.out.slice(start));
}

function oneLine(text: string): string {
  return escapePipes(
    text
      // Перенос строки prosemirror-markdown пишет как «\» и новую строку.
      .replace(/\\\n\s*/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
  );
}

/** Черта в тексте ячейки — разделитель колонок, если её не экранировать. */
export function escapePipes(text: string): string {
  return text.replace(/(\\*)\|/g, (match, slashes: string) =>
    slashes.length % 2 ? match : `${slashes}\\|`,
  );
}

const rowsOf = (table: PMNode) => table.children;
const colspan = (cell: PMNode) => Math.max(1, Number(cell.attrs.colspan) || 1);
const spanOf = (row: PMNode) => row.children.reduce((sum, cell) => sum + colspan(cell), 0);
