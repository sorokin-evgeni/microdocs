import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconCopy, IconGripVertical, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  BLOCK_TYPES,
  blockAt,
  blockTypeOf,
  deleteBlock,
  duplicateBlock,
  insertBelow,
  turnInto,
  type BlockTarget,
} from './blockTypes';
import { BLOCK_ICONS } from './blockIcons';

const SIZE = 24;
/** Мышь ушла с блока — ручка ждёт, чтобы до неё успели дотянуться. */
const HIDE_AFTER = 400;

interface Placed {
  target: BlockTarget;
  top: number;
}

/**
 * Ручка блока слева от текста, как в Notion: «+» — новая строка под блоком
 * со слэш-меню, «⋮⋮» — меню «Превратить в», дублировать, удалить; за неё же
 * блок перетаскивается.
 *
 * С мышью ручка у блока под указателем и прячется, пока печатают. На
 * сенсорном экране наведения нет — ручка у блока с курсором, и только «⋮⋮».
 */
export function BlockHandle({ editor, container }: { editor: Editor; container: RefObject<HTMLElement | null> }) {
  const touch = useMediaQuery('(hover: none)') ?? false;
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Пока тащат, ручку не убираем и не прячем: без видимого источника браузер отменит перенос.
  const [dragging, setDragging] = useState(false);
  const frozen = useRef(false);
  frozen.current = menuOpen || dragging;
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Место ручки: на уровне первой строки блока. */
  const place = useCallback(
    (target: BlockTarget | null) => {
      const box = container.current;
      const dom = target && (editor.view.nodeDOM(target.pos) as HTMLElement | null);
      if (!box || !target || !(dom instanceof HTMLElement)) {
        setPlaced(null);
        return;
      }
      const line =
        dom.matches('p, h1, h2, h3, h4, h5, h6, pre, hr, table, .tableWrapper')
          ? dom
          : (dom.querySelector<HTMLElement>('p, h1, h2, h3, h4, h5, h6, pre') ?? dom);
      const r = line.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || r.height;
      const height = line.matches('hr, table, .tableWrapper') ? r.height : Math.min(lineHeight, r.height);
      setPlaced({ target, top: r.top - box.getBoundingClientRect().top + (height - SIZE) / 2 });
    },
    [editor, container],
  );

  // Мышь: блок под указателем. Слева от текста — тоже он: ручка там и живёт.
  useEffect(() => {
    const box = container.current;
    if (!box || touch) return;
    const onMove = (event: MouseEvent) => {
      if (frozen.current) return;
      clearTimeout(hideTimer.current);
      const rect = editor.view.dom.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom) return;
      const left = Math.min(Math.max(event.clientX, rect.left + 48), rect.right - 4);
      const found = editor.view.posAtCoords({ left, top: event.clientY });
      if (!found) return;
      const { doc } = editor.state;
      const inside = found.inside >= 0 ? doc.nodeAt(found.inside) : null;
      place(inside?.isLeaf && inside.isBlock ? { pos: found.inside, node: inside } : blockAt(doc, found.pos));
    };
    const onLeave = () => {
      if (frozen.current) return;
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setPlaced(null), HIDE_AFTER);
    };
    // Печатают — ручка не мешает; вернётся с движением мыши.
    const onKey = () => {
      if (!frozen.current) setPlaced(null);
    };
    box.addEventListener('mousemove', onMove);
    box.addEventListener('mouseleave', onLeave);
    editor.view.dom.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(hideTimer.current);
      box.removeEventListener('mousemove', onMove);
      box.removeEventListener('mouseleave', onLeave);
      editor.view.dom.removeEventListener('keydown', onKey);
    };
  }, [editor, container, touch, place]);

  // Сенсорный экран: блок с курсором.
  useEffect(() => {
    if (!touch) return;
    const follow = () => {
      if (frozen.current) return;
      place(editor.isFocused ? blockAt(editor.state.doc, editor.state.selection.from) : null);
    };
    editor.on('selectionUpdate', follow);
    editor.on('update', follow);
    editor.on('focus', follow);
    return () => {
      editor.off('selectionUpdate', follow);
      editor.off('update', follow);
      editor.off('focus', follow);
    };
  }, [editor, touch, place]);

  if (!placed) return null;
  const { target } = placed;
  // Цель могла устареть, пока меню открыто: документ правят и с других устройств.
  const fresh = () => {
    const node = editor.state.doc.nodeAt(target.pos);
    return node === target.node ? target : blockAt(editor.state.doc, target.pos);
  };
  const current = blockTypeOf(editor.state.doc, target);
  const convertible = current !== null || ['listItem', 'taskItem'].includes(target.node.type.name);

  const onDragStart = (event: DragEvent) => {
    const t = fresh();
    if (!t) return;
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, t.pos)));
    const dom = view.nodeDOM(t.pos);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', t.node.textContent);
    if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
    // Перенос делает сам ProseMirror: на отпускании вставит срез и удалит исходный блок.
    (view as unknown as { dragging: unknown }).dragging = { slice: view.state.selection.content(), move: true };
    setDragging(true);
  };

  const onDragEnd = () => {
    setDragging(false);
    setPlaced(null);
  };

  return (
    <div
      className="block-handle"
      data-touch={touch || undefined}
      style={{ top: placed.top, opacity: dragging ? 0.4 : undefined }}
    >
      {!touch && (
        <ActionIcon
          variant="subtle"
          color="gray"
          size={SIZE}
          aria-label="Добавить блок ниже"
          onClick={() => {
            const t = fresh();
            if (t) insertBelow(editor, t);
            setPlaced(null);
          }}
        >
          <IconPlus size={16} stroke={1.6} />
        </ActionIcon>
      )}
      <Menu opened={menuOpen} onChange={setMenuOpen} position="bottom-start" shadow="md" width={240} withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={SIZE}
            aria-label="Действия с блоком"
            draggable={!touch}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            style={{ cursor: touch ? 'pointer' : 'grab' }}
          >
            <IconGripVertical size={16} stroke={1.6} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {convertible && (
            <>
              <Menu.Label>Превратить в</Menu.Label>
              {BLOCK_TYPES.filter((t) => !t.insertOnly).map((type) => {
                const Icon = BLOCK_ICONS[type.id];
                return (
                  <Menu.Item
                    key={type.id}
                    leftSection={Icon && <Icon size={16} stroke={1.6} />}
                    rightSection={type.id === current ? <IconCheck size={14} /> : null}
                    onClick={() => {
                      const t = fresh();
                      if (t) turnInto(editor, t, type);
                    }}
                  >
                    {type.label}
                  </Menu.Item>
                );
              })}
              <Menu.Divider />
            </>
          )}
          <Menu.Item
            leftSection={<IconCopy size={16} stroke={1.6} />}
            onClick={() => {
              const t = fresh();
              if (t) duplicateBlock(editor, t);
            }}
          >
            Дублировать
          </Menu.Item>
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={16} stroke={1.6} />}
            onClick={() => {
              const t = fresh();
              if (t) deleteBlock(editor, t);
              setPlaced(null);
            }}
          >
            Удалить
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
