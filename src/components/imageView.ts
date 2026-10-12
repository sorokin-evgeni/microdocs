import type { NodeViewRenderer } from '@tiptap/core';
import { assetUrl, parseLink } from '../domain/links';

/**
 * Ширина картинки в Markdown. Своего места для неё там нет, поэтому она едет
 * в адресе: `![](microdocs:asset/uploads/….png#w=320)`. Ссылка остаётся
 * обычной, а редактор, который о ширине не знает, покажет картинку как есть.
 * Без ширины картинка в своём размере, но не шире колонки.
 */
const WIDTH = /#w=(\d{1,5})$/;

/** Самая узкая картинка, до которой можно сжать ручкой. */
export const MIN_WIDTH = 48;

export function splitWidth(src: string): { src: string; width: number | null } {
  const match = WIDTH.exec(src);
  if (!match) return { src, width: null };
  const width = Number(match[1]);
  return { src: src.slice(0, match.index), width: width > 0 ? width : null };
}

export function withWidth(src: string, width: number | null | undefined): string {
  return width ? `${src}#w=${Math.round(width)}` : src;
}

/** Адрес для браузера: ссылку на вложение — в адрес сервера. */
export function displaySrc(src: string): string {
  const target = parseLink(src);
  return target.kind === 'asset' ? assetUrl(target.path) : src;
}

/**
 * Картинка с ручкой в правом нижнем углу: тянешь — меняется ширина, высота
 * следует пропорционально. Двойной клик по ручке — снова свой размер.
 * Pointer-события — одинаково мышью и пальцем; на телефоне ручка видна,
 * когда картинку выделили касанием.
 */
export function imageView(): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    let current = node;

    const dom = document.createElement('span');
    dom.className = 'md-image';
    const img = document.createElement('img');
    const handle = document.createElement('span');
    handle.className = 'md-image-handle';
    handle.contentEditable = 'false';
    handle.title = 'Потяните, чтобы изменить размер. Двойной клик — исходный размер';
    dom.append(img, handle);

    const render = () => {
      const { src, alt, title, width } = current.attrs as {
        src: string | null;
        alt: string | null;
        title: string | null;
        width: number | null;
      };
      const shown = displaySrc(src ?? '');
      if (img.getAttribute('src') !== shown) img.setAttribute('src', shown);
      img.alt = alt ?? '';
      if (title) img.title = title;
      else img.removeAttribute('title');
      img.style.width = width ? `${width}px` : '';
    };
    render();

    const commit = (width: number | null) => {
      const pos = getPos();
      if (typeof pos !== 'number' || width === current.attrs.width) return;
      editor.chain().setNodeSelection(pos).updateAttributes(current.type.name, { width }).run();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (!editor.isEditable || event.button !== 0) return;
      // Иначе браузер начал бы перетаскивать саму картинку, а палец — прокручивать страницу.
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startWidth = img.getBoundingClientRect().width;
      const column = (dom.closest('.ProseMirror') as HTMLElement | null)?.clientWidth ?? Infinity;
      let width = Math.round(startWidth);
      dom.classList.add('is-resizing');

      const onMove = (move: PointerEvent) => {
        width = Math.round(Math.min(Math.max(startWidth + move.clientX - startX, MIN_WIDTH), column));
        img.style.width = `${width}px`;
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        dom.classList.remove('is-resizing');
        // Просто щёлкнули, не потянув, — размер не трогаем.
        if (width !== Math.round(startWidth)) commit(width);
        else render();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      commit(null);
    });

    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      // Ручку обрабатываем сами: редактору незачем ставить по ней курсор.
      stopEvent: (event) => event.target === handle,
      // Ширину во время перетаскивания меняем мы — это не правка документа.
      ignoreMutation: () => true,
    };
  };
}
