import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { LINK_SCHEME, assetLinkFromUrl, assetUrl, parseLink } from '../domain/links';
import type { PageId } from '../types';

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

/**
 * Расширения редактора. Отдельно от компонента — чтобы разбор и запись Markdown
 * проверялись тестами без React.
 */
export function editorExtensions() {
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
