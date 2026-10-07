import type { ChainedCommands, Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Типы блоков для меню ручки («Превратить в») и слэш-меню.
 * Каждый тип умеет превратить в себя блок под курсором: сначала блок
 * сбрасывается в обычный абзац (clearNodes снимает и списки, и цитаты),
 * потом получает новый вид. Так из любого блока выходит любой другой.
 */
export interface BlockType {
  id: string;
  label: string;
  /** Как набрать в Markdown — подсказка справа в меню. */
  hint?: string;
  /** Для поиска в слэш-меню, кроме названия. */
  keywords: string[];
  /** Только вставка: из блока такой не сделать (таблица, разделитель). */
  insertOnly?: boolean;
  apply: (chain: ChainedCommands) => ChainedCommands;
  /** Таков ли блок-цель ручки. */
  matches?: (node: PMNode) => boolean;
}

const heading = (level: 1 | 2 | 3): BlockType => ({
  id: `h${level}`,
  label: `Заголовок ${level}`,
  hint: `${'#'.repeat(level)} `,
  keywords: [`h${level}`, 'heading', 'заголовок', 'title'],
  apply: (c) => c.clearNodes().setHeading({ level }),
  matches: (n) => n.type.name === 'heading' && n.attrs.level === level,
});

const isList = (name: string) => (n: PMNode) => n.type.name === name;

export const BLOCK_TYPES: BlockType[] = [
  {
    id: 'paragraph',
    label: 'Текст',
    keywords: ['text', 'paragraph', 'текст', 'абзац', 'plain'],
    apply: (c) => c.clearNodes(),
    matches: (n) => n.type.name === 'paragraph',
  },
  heading(1),
  heading(2),
  heading(3),
  {
    id: 'bulletList',
    label: 'Маркированный список',
    hint: '- ',
    keywords: ['list', 'bullet', 'ul', 'список', 'маркированный'],
    apply: (c) => c.clearNodes().toggleBulletList(),
    matches: isList('bulletList'),
  },
  {
    id: 'orderedList',
    label: 'Нумерованный список',
    hint: '1. ',
    keywords: ['list', 'ordered', 'numbered', 'ol', 'список', 'нумерованный'],
    apply: (c) => c.clearNodes().toggleOrderedList(),
    matches: isList('orderedList'),
  },
  {
    id: 'taskList',
    label: 'Чек-лист',
    hint: '[] ',
    keywords: ['todo', 'task', 'check', 'checkbox', 'чек', 'задачи', 'галочки'],
    apply: (c) => c.clearNodes().toggleTaskList(),
    matches: isList('taskList'),
  },
  {
    id: 'blockquote',
    label: 'Цитата',
    hint: '> ',
    keywords: ['quote', 'blockquote', 'цитата'],
    apply: (c) => c.clearNodes().setBlockquote(),
    matches: (n) => n.type.name === 'blockquote',
  },
  {
    id: 'codeBlock',
    label: 'Код',
    hint: '```',
    keywords: ['code', 'pre', 'код'],
    apply: (c) => c.clearNodes().setCodeBlock(),
    matches: (n) => n.type.name === 'codeBlock',
  },
  {
    id: 'table',
    label: 'Таблица',
    keywords: ['table', 'grid', 'таблица'],
    insertOnly: true,
    apply: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    id: 'horizontalRule',
    label: 'Разделитель',
    hint: '---',
    keywords: ['divider', 'hr', 'rule', 'line', 'разделитель', 'линия'],
    insertOnly: true,
    apply: (c) => c.setHorizontalRule(),
  },
];

/** Типы для слэш-меню по набранному после «/»: по началу слова в названии или ключевых словах. */
export function filterBlockTypes(query: string): BlockType[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_TYPES;
  return BLOCK_TYPES.filter(
    (t) =>
      t.label
        .toLowerCase()
        .split(/[\s-]+/)
        .some((word) => word.startsWith(q)) ||
      t.label.toLowerCase().startsWith(q) ||
      t.keywords.some((k) => k.startsWith(q)),
  );
}

/** Блок, к которому относится ручка: позиция и узел. */
export interface BlockTarget {
  pos: number;
  node: PMNode;
}

const ITEMS = new Set(['listItem', 'taskItem']);

/**
 * Блок под позицией документа. Обычно это блок верхнего уровня; в списке —
 * самый глубокий пункт: у каждого пункта своя ручка, как в Notion.
 */
export function blockAt(doc: PMNode, pos: number): BlockTarget | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth === 0) {
    const node = doc.nodeAt($pos.pos);
    return node ? { pos: $pos.pos, node } : null;
  }
  for (let d = $pos.depth; d >= 1; d--) {
    if (ITEMS.has($pos.node(d).type.name)) return { pos: $pos.before(d), node: $pos.node(d) };
  }
  return { pos: $pos.before(1), node: $pos.node(1) };
}

/** Вид блока-цели для отметки в меню «Превратить в». */
export function blockTypeOf(doc: PMNode, target: BlockTarget): string | null {
  let node = target.node;
  if (ITEMS.has(node.type.name)) {
    // Вид пункта — вид его списка.
    const parent = doc.resolve(target.pos).parent;
    return BLOCK_TYPES.find((t) => t.matches?.(parent))?.id ?? null;
  }
  return BLOCK_TYPES.find((t) => t.matches?.(node))?.id ?? null;
}

/**
 * Превратить блок-цель в другой вид: выделить его текст и применить тип.
 * У пункта списка — только его собственную строку, вложенные пункты не трогаем;
 * у цитаты — весь текст в ней.
 */
export function turnInto(editor: Editor, target: BlockTarget, type: BlockType): void {
  const { node, pos } = target;
  let from = -1;
  let to = -1;
  if (node.isTextblock) {
    from = pos + 1;
    to = pos + node.nodeSize - 1;
  } else {
    const onlyFirst = ITEMS.has(node.type.name);
    node.descendants((child, offset) => {
      if (onlyFirst && from >= 0) return false;
      if (!child.isTextblock) return true;
      const start = pos + 1 + offset + 1;
      if (from < 0) from = start;
      to = start + child.content.size;
      return false;
    });
  }
  if (from < 0) return;
  type.apply(editor.chain().focus().setTextSelection({ from, to })).run();
  // Выделенным блок не оставляем: курсор — в конец, как будто его и печатали.
  editor.commands.setTextSelection(editor.state.selection.to);
}

export function duplicateBlock(editor: Editor, target: BlockTarget): void {
  editor
    .chain()
    .focus()
    .insertContentAt(target.pos + target.node.nodeSize, target.node.toJSON())
    .run();
}

export function deleteBlock(editor: Editor, target: BlockTarget): void {
  editor
    .chain()
    .focus()
    .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
    .run();
}

/**
 * «+» у ручки: пустая строка под блоком с «/» — сразу открывается слэш-меню.
 * Пустой абзац не плодим: «/» встаёт в него самого.
 */
export function insertBelow(editor: Editor, target: BlockTarget): void {
  const { doc } = editor.state;
  // Вставляем после блока верхнего уровня: внутрь списка абзац не встанет.
  const $pos = doc.resolve(target.pos);
  const top = $pos.depth === 0 ? target : { pos: $pos.before(1), node: $pos.node(1) };
  if (top.node.type.name === 'paragraph' && top.node.content.size === 0) {
    editor.chain().focus().insertContentAt(top.pos + 1, '/').run();
    return;
  }
  const at = top.pos + top.node.nodeSize;
  editor
    .chain()
    .focus()
    .insertContentAt(at, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
    .setTextSelection(at + 2)
    .run();
}
