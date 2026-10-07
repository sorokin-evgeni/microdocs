import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Paper, Portal, Text, UnstyledButton } from '@mantine/core';
import type { SlashController } from './slashCommand';
import { BLOCK_ICONS } from './blockIcons';

const WIDTH = 280;
const MAX_HEIGHT = 320;

/**
 * Меню блоков по «/». Стоит под курсором, а если внизу не помещается — над ним.
 * Мышь выбирает щелчком; клавиши обрабатывает SlashController.
 */
export function SlashMenu({ controller }: { controller: SlashController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.get);
  const list = useRef<HTMLDivElement>(null);

  // Выбранный пункт стрелками — в видимой части списка.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [state?.selected]);

  if (!state || !state.rect) return null;
  const { rect } = state;
  const below = window.innerHeight - rect.bottom >= MAX_HEIGHT + 8 || rect.top < MAX_HEIGHT + 8;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));

  return (
    <Portal>
      <Paper
        ref={list}
        className="slash-menu"
        shadow="md"
        withBorder
        radius="md"
        p={4}
        role="listbox"
        aria-label="Тип блока"
        style={{
          position: 'fixed',
          left,
          ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
          width: WIDTH,
          maxHeight: MAX_HEIGHT,
          overflowY: 'auto',
          zIndex: 300,
        }}
        // Щелчок не должен уводить фокус из редактора — иначе меню закроется раньше выбора.
        onMouseDown={(e) => e.preventDefault()}
      >
        {state.items.map((item, i) => {
          const Icon = BLOCK_ICONS[item.id];
          return (
            <UnstyledButton
              key={item.id}
              className="slash-menu-item"
              role="option"
              aria-selected={i === state.selected}
              data-selected={i === state.selected}
              onMouseEnter={() => controller.select(i)}
              onClick={() => state.choose(item)}
            >
              <span className="slash-menu-icon">{Icon && <Icon size={16} stroke={1.6} />}</span>
              <Text size="sm" style={{ flex: 1 }}>
                {item.label}
              </Text>
              {item.hint && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {item.hint.trim()}
                </Text>
              )}
            </UnstyledButton>
          );
        })}
      </Paper>
    </Portal>
  );
}
