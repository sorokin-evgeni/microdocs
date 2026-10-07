import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import { LINK_SCHEME, assetLinkFromUrl, assetUrl, parseLink } from '../domain/links';
import type { PageId } from '../types';
import { serializeTable } from './markdownTable';
import { slashCommand, type SlashController } from './slashCommand';

/**
 * Картинка хранит в документе адрес как в Markdown — `microdocs:asset/<путь>`, —
 * а браузеру показывает рабочий `/api/assets/<путь>`. Храни документ адрес сервера,
 * первая же правка записала бы его в текст вместо ссылки на вложение.
 */
const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // Скопированная из редактора картинка приходит с адресом сервера — возвращаем ссылку.
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute('src');
          return (src && assetLinkFromUrl(src)) ?? src;
        },
        renderHTML: (attributes: { src?: string | null }) => {
          const src = attributes.src ?? '';
          const target = parseLink(src);
          return { src: target.kind === 'asset' ? assetUrl(target.path) : src };
        },
      },
    };
  },
});

const MarkdownTable = Table.extend({
  addStorage() {
    return { ...this.parent?.(), markdown: { serialize: serializeTable, parse: {} } };
  },
});

// В ячейке ровно один абзац: больше Markdown-таблица не выражает,
// а собранное в интерфейсе сверх этого пропало бы при записи.
const SingleLineCell = TableCell.extend({ content: 'paragraph' });
const SingleLineHeader = TableHeader.extend({ content: 'paragraph' });

const ITEMS = ['listItem', 'taskItem'];

/**
 * Чек-лист без пустых строк между пунктами, как обычные списки: tiptap-markdown
 * помечает «плотными» только маркированный и нумерованный, а без пометки
 * «- [ ] дело» на каждой записи разъезжался бы через строку.
 */
const TightTaskList = Extension.create({
  name: 'tightTaskList',
  // Разбор Markdown — раньше чек-листа из tiptap-markdown: см. updateDOM.
  priority: 1000,
  addStorage() {
    return { markdown: { parse: { updateDOM: unmixTaskLists } } };
  },
  addGlobalAttributes() {
    return [
      {
        types: ['taskList'],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
            renderHTML: (attributes: { tight?: boolean }) => (attributes.tight ? { 'data-tight': 'true' } : {}),
          },
        },
      },
    ];
  },
});

/**
 * Список, где галочки только у части пунктов, остаётся обычным списком, а
 * «[ ]» — текстом, как было до чек-листов. Иначе пункты без галочки не
 * поместились бы в чек-лист и редактор достроил бы его пустыми пунктами.
 */
function unmixTaskLists(element: HTMLElement) {
  for (const list of element.querySelectorAll('.contains-task-list')) {
    const items = [...list.children].filter((child) => child.tagName === 'LI');
    if (items.every((item) => item.classList.contains('task-list-item'))) continue;
    list.classList.remove('contains-task-list');
    for (const item of items) {
      if (!item.classList.contains('task-list-item')) continue;
      item.classList.remove('task-list-item');
      const box = item.querySelector<HTMLInputElement>(':scope > input, :scope > p > input');
      box?.replaceWith(box.checked ? '[x] ' : '[ ] ');
    }
  }
}

/**
 * Backspace в начале заголовка, пункта списка или цитаты сначала превращает
 * блок в обычный текст, и только следующий — склеивает с предыдущей строкой,
 * как в Notion. Вложенный пункт списка поднимается на уровень выше.
 */
export const BackspaceToText = Extension.create({
  name: 'backspaceToText',
  // Раньше клавиш списков из StarterKit: те склеили бы пункт с предыдущим.
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name === 'heading') return editor.commands.setParagraph();
        // Строка — первая в своём пункте или цитате.
        for (let d = $from.depth - 1; d >= 1; d--) {
          if ($from.index(d) !== 0) return false;
          const name = $from.node(d).type.name;
          if (ITEMS.includes(name)) return editor.commands.liftListItem(name);
          if (name === 'blockquote') return editor.commands.lift('blockquote');
        }
        return false;
      },
    };
  },
});

/**
 * Расширения редактора. Отдельно от компонента — чтобы разбор и запись Markdown
 * проверялись тестами без React. Слэш-меню — только когда есть кому его показать.
 */
export function editorExtensions(slash?: SlashController) {
  return [
    StarterKit.configure({
      link: {
        // Незнакомую схему расширение выбрасывает при разборе: ссылка импорта
        // показалась бы текстом, а первая же правка стёрла бы адрес.
        protocols: [LINK_SCHEME],
        // Переходы решает followLink: внутренняя ссылка — не адрес для window.open.
        openOnClick: false,
      },
    }),
    // В Markdown картинка — часть строки, поэтому и здесь она строчная:
    // блочная разорвала бы абзац, где рядом с ней есть текст.
    AssetImage.configure({ inline: true }),
    // Ширину колонок Markdown не хранит — тянуть их мышью незачем.
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    SingleLineHeader,
    SingleLineCell,
    // «- [ ] дело» в Markdown — пункт с галочкой.
    TaskList,
    TaskItem.configure({ nested: true }),
    TightTaskList,
    BackspaceToText,
    ...(slash ? [slashCommand(slash)] : []),
    Markdown.configure({
      html: false,
      // Неподдерживаемое не выбрасываем, а оставляем в исходнике (FR-23).
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

/**
 * Клик по ссылке в тексте. Возвращает true, если клик обработан.
 *
 * Страница открывается внутри приложения, вложение и внешняя ссылка —
 * в новой вкладке, как было и до своего обработчика.
 */
export function followLink(event: MouseEvent, openPage: (id: PageId) => void): boolean {
  if (event.button !== 0) return false;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return false;

  event.preventDefault();
  const target = parseLink(anchor.getAttribute('href') ?? '');
  if (target.kind === 'page') openPage(target.id);
  else window.open(target.kind === 'asset' ? assetUrl(target.path) : target.href, '_blank', 'noopener,noreferrer');
  return true;
}
