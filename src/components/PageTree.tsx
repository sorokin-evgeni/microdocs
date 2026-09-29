import { useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Menu, Text, UnstyledButton } from '@mantine/core';
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
  const [collapsed, setCollapsed] = useState<Set<PageId>>(new Set());

  // Страница могла открыться по ссылке внутри свёрнутой ветки — раскрываем её предков.
  // Только при смене выбора: свернуть ветку с текущей страницей по-прежнему можно.
  useEffect(() => {
    if (!props.selectedId) return;
    const path = ancestorIds(props.tree, props.selectedId);
    setCollapsed((prev) =>
      path.some((id) => prev.has(id)) ? new Set([...prev].filter((id) => !path.includes(id))) : prev,
    );
  }, [props.selectedId]);

  const toggle = (id: PageId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
