import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import { LINK_SCHEME, assetLink, assetLinkFromUrl, assetUrl, parseLink } from '../domain/links';
import { displaySrc, imageView, splitWidth, withWidth } from './imageView';
import { UPLOAD_TYPES } from '../../shared/uploads';
import type { PageId } from '../types';
import { serializeTable } from './markdownTable';
import { slashCommand, type SlashController } from './slashCommand';

/**
 * Картинка хранит в документе адрес как в Markdown — `microdocs:asset/<путь>`, —
 * а браузеру показывает рабочий `/api/assets/<путь>`. Храни документ адрес сервера,
 * первая же правка записала бы его в текст вместо ссылки на вложение.
 *
 * Ширина — отдельный атрибут, а в Markdown едет хвостом адреса (`#w=320`,
 * см. imageView.ts). Высоту не храним: она всегда по пропорциям.
 */
const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // Скопированная из редактора картинка приходит с адресом сервера — возвращаем ссылку.
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('src');
          if (!raw) return raw;
          const { src } = splitWidth(raw);
          return assetLinkFromUrl(src) ?? src;
        },
        renderHTML: (attributes: { src?: string | null }) => ({ src: displaySrc(attributes.src ?? '') }),
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const fromSrc = splitWidth(element.getAttribute('src') ?? '').width;
          const attr = Number(element.getAttribute('width'));
          return fromSrc ?? (attr > 0 ? Math.round(attr) : null);
        },
        renderHTML: (attributes: { width?: number | null }) =>
          attributes.width ? { width: attributes.width } : {},
      },
      height: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },
  addNodeView() {
    return imageView();
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // Как у prosemirror-markdown, только с шириной в адресе.
        serialize(
          state: { write: (text: string) => void; esc: (text: string) => string },
          node: { attrs: { src?: string | null; alt?: string | null; title?: string | null; width?: number | null } },
        ) {
          const { src, alt, title, width } = node.attrs;
          state.write(
            `![${state.esc(alt || '')}](${withWidth(src ?? '', width).replace(/[()]/g, '\\$&')}` +
              (title ? ` "${title.replace(/"/g, '\\"')}"` : '') +
              ')',
          );
        },
        parse: {},
      },
    };
  },
});

/**
 * Загрузить картинку. Возвращает путь вложения; null — не вышло,
 * и человеку уже объяснили почему.
 */
export type UploadImage = (file: File) => Promise<string | null>;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageUpload: {
      /** Выбрать картинки с устройства и вставить там, где курсор. */
      pickImage: () => ReturnType;
    };
  }
}

const IMAGE_ACCEPT = Object.keys(UPLOAD_TYPES).join(',');

const imageFiles = (files: FileList | null | undefined) =>
  [...(files ?? [])].filter((file) => file.type.startsWith('image/'));

/**
 * Картинки в текст: вставкой из буфера, перетаскиванием файла и выбором
 * с устройства (`pickImage`, пункт слэш-меню). Файл сначала загружается,
 * потом в текст встаёт ссылка на вложение. По одной, в том порядке, как пришли.
 */
const ImageUpload = Extension.create<{ upload: UploadImage | null }>({
  name: 'imageUpload',
  addOptions: () => ({ upload: null }),

  addCommands() {
    return {
      pickImage:
        () =>
        ({ editor, dispatch }) => {
          const upload = this.options.upload;
          if (!upload) return false;
          // Без dispatch это лишь проверка can() — диалог не открываем.
          if (!dispatch) return true;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = IMAGE_ACCEPT;
          input.multiple = true;
          input.addEventListener('change', () => void insertImages(editor, upload, imageFiles(input.files)));
          input.click();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const upload = this.options.upload;
    const editor = this.editor;
    if (!upload) return [];
    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          // Скопированная в браузере картинка приходит файлом без текста. Если
          // текст есть — копировали документ (Word, таблицу), и картинка в
          // буфере — лишь его снимок: вставляем текст, как раньше.
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            const files = imageFiles(data?.files);
            if (files.length === 0 || hasOwnText(data?.getData('text/plain') ?? '', files)) return false;
            event.preventDefault();
            void insertImages(editor, upload, files);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImages(editor, upload, files, at);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * В буфере есть текст сам по себе, а не только имена файлов: скопированный
 * в Finder или Проводнике файл приходит вместе со своим именем как текстом.
 */
export function hasOwnText(text: string, files: File[]): boolean {
  const names = new Set(files.map((file) => file.name));
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line && !names.has(line) && !names.has(line.split(/[\\/]/).pop() ?? ''));
}

async function insertImages(editor: Editor, upload: UploadImage, files: File[], at?: number) {
  for (const file of files) {
    const path = await upload(file);
    // Пока грузилось, могли уйти на другую страницу — этого редактора уже нет.
    if (!path || editor.isDestroyed) continue;
    const content = { type: 'image', attrs: { src: assetLink(path), alt: '' } };
    const chain = editor.chain().focus();
    if (at === undefined) {
      chain.insertContent(content).run();
    } else {
      chain.insertContentAt(Math.min(at, editor.state.doc.content.size), content).run();
      // Следующая — за этой, а не перед ней.
      at = editor.state.selection.to;
    }
  }
}

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
 * проверялись тестами без React. Слэш-меню — только когда есть кому его показать,
 * загрузка картинок — когда есть куда грузить.
 */
export function editorExtensions(slash?: SlashController, upload?: UploadImage) {
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
    ImageUpload.configure({ upload: upload ?? null }),
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
