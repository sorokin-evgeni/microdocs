import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ActionIcon, Box, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFile,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import type { PageId, Tree, TreeNode } from '../types';
import { ancestorIds, canMove, findNode, type DropPosition } from '../domain/tree';

interface Props {
  tree: Tree;
  selectedId: PageId | null;
  onSelect: (id: PageId) => void;
  onCreateChild: (parentId: PageId) => void;
  onDelete: (id: PageId) => void;
  onMoveRequest: (id: PageId) => void;
  onShift: (id: PageId, delta: -1 | 1) => void;
  onPlace: (id: PageId, targetId: PageId, position: DropPosition) => void;
}

interface DropTarget {
  id: PageId;
  position: DropPosition;
}

/** Свой тип данных: обычный текст вставился бы в редактор, если бросить строку туда. */
const DRAG_TYPE = 'application/x-microdocs-page';

export function PageTree(props: Props) {
  // Храним свёрнутые: по умолчанию дерево раскрыто целиком.
  // Своё в каждом браузере, переживает перезагрузку.
  const [collapsedIds, setCollapsedIds] = useLocalStorage<PageId[]>({
    key: 'microdocs:collapsed-pages',
    defaultValue: [],
    getInitialValueInEffect: false,
    deserialize: parseIds,
  });
  const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);

  // Страница могла открыться по ссылке внутри свёрнутой ветки — раскрываем её предков.
  // Только при переходе, не при загрузке: свёрнутая ветка с текущей страницей
  // остаётся свёрнутой и после перезагрузки.
  const shownId = useRef(props.selectedId);
  useEffect(() => {
    if (!props.selectedId || props.selectedId === shownId.current) return;
    shownId.current = props.selectedId;
    const path = ancestorIds(props.tree, props.selectedId);
    setCollapsedIds((prev) =>
      prev.some((id) => path.includes(id)) ? prev.filter((id) => !path.includes(id)) : prev,
    );
  }, [props.selectedId]);

  const toggle = (id: PageId) =>
    setCollapsedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Перетаскивание мышью, нативное браузерное. Обработчики общие на весь список,
  // строку находим по data-page-id.
  const [draggedId, setDraggedId] = useState<PageId | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const endDrag = () => {
    setDraggedId(null);
    setDrop(null);
  };

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    const id = rowOf(event.target)?.dataset.pageId;
    if (!id) return;
    event.dataTransfer.effectAllowed = 'move';
    // Firefox без данных не начинает перетаскивание.
    event.dataTransfer.setData(DRAG_TYPE, id);
    setDraggedId(id);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!draggedId) return;
    const row = rowOf(event.target);
    const targetId = row?.dataset.pageId;
    if (!row || !targetId) {
      // Зазор между строками: цель прежняя, иначе метка мигала бы на каждой границе.
      if (drop) event.preventDefault();
      return;
    }
    if (!canMove(props.tree, draggedId, targetId)) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = findNode(props.tree, targetId);
    const openBranch = !!target && target.children.length > 0 && !collapsed.has(targetId);
    const position = positionAt(event.clientY, row.getBoundingClientRect(), openBranch);
    if (drop?.id !== targetId || drop.position !== position) setDrop({ id: targetId, position });
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (draggedId && drop) props.onPlace(draggedId, drop.id, drop.position);
    endDrag();
  };

  // Строки идут одним плоским списком (Row отдаёт фрагменты), так что зазор — между всеми.
  return (
    <Stack
      gap={2}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={endDrag}
    >
      {props.tree.roots.map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          draggedId={draggedId}
          drop={drop}
          {...props}
        />
      ))}
    </Stack>
  );
}

function rowOf(target: EventTarget): HTMLElement | null {
  return (target as Element).closest<HTMLElement>('[data-page-id]');
}

/**
 * Верхняя четверть строки — перед ней, нижняя — после, середина — внутрь.
 * Под раскрытой веткой сразу идут её дети, и «после» легло бы не туда, куда
 * показывает метка, — поэтому у раскрытой ветки вся нижняя часть значит «внутрь».
 */
function positionAt(y: number, rect: DOMRect, openBranch: boolean): DropPosition {
  const offset = (y - rect.top) / rect.height;
  if (offset < 0.25) return 'before';
  if (offset > 0.75 && !openBranch) return 'after';
  return 'inside';
}

/** Хранилище могли испортить руками — тогда просто всё раскрыто. */
function parseIds(raw: string | undefined): PageId[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

interface RowProps extends Props {
  node: TreeNode;
  depth: number;
  collapsed: Set<PageId>;
  onToggle: (id: PageId) => void;
  draggedId: PageId | null;
  drop: DropTarget | null;
}

/**
 * Иконка страницы в слоте фиксированной ширины. Без своей иконки — бледный
 * серый листочек: названия стоят ровно, а взгляд не цепляется за пустышки.
 */
function PageGlyph({ icon }: { icon: string | undefined }) {
  return (
    <Box
      component="span"
      w={20}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        justifyContent: 'center',
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {icon ?? (
        <IconFile
          size={16}
          stroke={1.5}
          aria-hidden
          style={{ color: 'var(--mantine-color-dimmed)', opacity: 0.55 }}
        />
      )}
    </Box>
  );
}

function Row({ node, depth, collapsed, onToggle, ...rest }: RowProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(node.id);
  const isSelected = rest.selectedId === node.id;
  const dropHere = rest.drop?.id === node.id ? rest.drop.position : null;
  const indent = 6 + depth * 16;

  return (
    <>
      <Group
        data-page-id={node.id}
        draggable
        gap={4}
        wrap="nowrap"
        pl={indent}
        pr={6}
        pos="relative"
        style={{
          borderRadius: 6,
          background:
            dropHere === 'inside'
              ? 'var(--mantine-primary-color-light)'
              : isSelected
                ? 'var(--mantine-color-default-hover)'
                : undefined,
          opacity: rest.draggedId === node.id ? 0.5 : undefined,
        }}
      >
        {(dropHere === 'before' || dropHere === 'after') && (
          // Черта с отступом строки: видно, на какой уровень встанет страница.
          <Box
            pos="absolute"
            left={indent}
            right={6}
            top={dropHere === 'before' ? 0 : undefined}
            bottom={dropHere === 'after' ? 0 : undefined}
            h={2}
            bg="var(--mantine-primary-color-filled)"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {hasChildren ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={20}
            onClick={() => onToggle(node.id)}
            aria-label={`${isOpen ? 'Свернуть' : 'Развернуть'}: ${node.title}`}
          >
            {isOpen ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
          </ActionIcon>
        ) : (
          // Отступ вместо кнопки: скрытая кнопка осталась бы в дереве доступности.
          <Box w={20} style={{ flexShrink: 0 }} />
        )}

        <UnstyledButton
          onClick={() => rest.onSelect(node.id)}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <PageGlyph icon={node.icon} />
          {/* Отступ у текста, а не у кнопки: Firefox не начинает перетаскивание с полей кнопки. */}
          <Text size="md" truncate fw={isSelected ? 600 : 400} py={4} style={{ flex: 1, minWidth: 0 }}>
            {node.title || 'Без названия'}
          </Text>
        </UnstyledButton>

        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={20}
              aria-label={`Действия: ${node.title}`}
            >
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconPlus size={13} />}
              onClick={() => rest.onCreateChild(node.id)}
            >
              Добавить вложенную
            </Menu.Item>
            <Menu.Item
              leftSection={<IconArrowUp size={13} />}
              onClick={() => rest.onShift(node.id, -1)}
            >
              Выше
            </Menu.Item>
            <Menu.Item
              leftSection={<IconArrowDown size={13} />}
              onClick={() => rest.onShift(node.id, 1)}
            >
              Ниже
            </Menu.Item>
            <Menu.Item onClick={() => rest.onMoveRequest(node.id)}>
              Переместить…
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={13} />}
              onClick={() => rest.onDelete(node.id)}
            >
              Удалить
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {isOpen &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            {...rest}
          />
        ))}
    </>
  );
}
