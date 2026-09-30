import { useState } from 'react';
import { Box } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import classes from './NavbarResizer.module.css';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

const clamp = (width: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

/** Ширина списка страниц. Своя в каждом браузере, переживает перезагрузку. */
export function useNavbarWidth() {
  return useLocalStorage<number>({
    key: 'microdocs:navbar-width',
    defaultValue: DEFAULT_WIDTH,
    // Иначе при загрузке мелькнёт ширина по умолчанию.
    getInitialValueInEffect: false,
    serialize: String,
    deserialize: (raw) => {
      const width = Number(raw);
      return Number.isFinite(width) ? clamp(width) : DEFAULT_WIDTH;
    },
  });
}

interface Props {
  onResize: (width: number) => void;
}

/**
 * Разделитель между списком страниц и страницей: тянешь — меняется ширина списка.
 * Список прижат к левому краю окна, поэтому ширина — это просто координата курсора.
 * На телефоне список выезжает поверх страницы, тянуть там нечего.
 */
export function NavbarResizer({ onResize }: Props) {
  const [dragging, setDragging] = useState(false);

  return (
    <Box
      visibleFrom="sm"
      className={classes.handle}
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина списка страниц"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Без этого вместе с перетаскиванием выделялся бы текст.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (dragging) onResize(clamp(event.clientX));
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    />
  );
}
