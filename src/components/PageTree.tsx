import { useEffect, useMemo, useRef } from 'react';
import { ActionIcon, Box, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import type { PageId, Tree, TreeNode } from '../types';
import { ancestorIds } from '../domain/tree';

interface Props {
  tree: Tree;
  selectedId: PageId | null;
  onSelect: (id: PageId) => void;
  onCreateChild: (parentId: PageId) => void;
  onDelete: (id: PageId) => void;
  onMoveRequest: (id: PageId) => void;
  onShift: (id: PageId, delta: -1 | 1) => void;
}

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

  return (
    <Box>
      {props.tree.roots.map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          {...props}
        />
      ))}
    </Box>
  );
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
}

function Row({ node, depth, collapsed, onToggle, ...rest }: RowProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(node.id);
  const isSelected = rest.selectedId === node.id;

  return (
    <>
      <Group
        gap={2}
        wrap="nowrap"
        pl={4 + depth * 12}
        pr={4}
        style={{
          borderRadius: 4,
          background: isSelected
            ? 'var(--mantine-color-default-hover)'
            : undefined,
        }}
      >
        {hasChildren ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={18}
            onClick={() => onToggle(node.id)}
            aria-label={`${isOpen ? 'Свернуть' : 'Развернуть'}: ${node.title}`}
          >
            {isOpen ? (
              <IconChevronDown size={13} />
            ) : (
              <IconChevronRight size={13} />
            )}
          </ActionIcon>
        ) : (
          // Отступ вместо кнопки: скрытая кнопка осталась бы в дереве доступности.
          <Box w={18} style={{ flexShrink: 0 }} />
        )}

        <UnstyledButton
          onClick={() => rest.onSelect(node.id)}
          style={{ flex: 1, minWidth: 0, paddingBlock: 3 }}
        >
          <Text size="sm" truncate fw={isSelected ? 600 : 400}>
            {node.title || 'Без названия'}
          </Text>
        </UnstyledButton>

        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={18}
              aria-label={`Действия: ${node.title}`}
            >
              <IconDots size={13} />
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
