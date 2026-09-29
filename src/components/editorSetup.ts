import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { LINK_SCHEME, parseLink } from '../domain/links';
import type { PageId } from '../types';

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
 * Внешняя открывается в новой вкладке — как было и до своего обработчика.
 * Вложения сервер пока не отдаёт, поэтому клик по ним ничего не делает.
 */
export function followLink(event: MouseEvent, openPage: (id: PageId) => void): boolean {
  if (event.button !== 0) return false;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return false;

  event.preventDefault();
  const target = parseLink(anchor.getAttribute('href') ?? '');
  if (target.kind === 'page') openPage(target.id);
  else if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer');
  return true;
}
