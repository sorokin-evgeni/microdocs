import { Modal, ScrollArea, UnstyledButton, Text, Stack } from '@mantine/core';
import type { PageId, Tree, TreeNode } from '../types';
import { canMove } from '../domain/tree';

interface Props {
  tree: Tree;
  pageId: PageId | null;
  onClose: () => void;
  onMove: (newParentId: PageId | null) => void;
}

interface Target {
  id: PageId;
  title: string;
  depth: number;
}

function flatten(nodes: TreeNode[], depth = 0): Target[] {
  return nodes.flatMap((n) => [
    { id: n.id, title: n.title, depth },
    ...flatten(n.children, depth + 1),
  ]);
}

/** Выбор нового родителя. Недопустимые цели (FR-9) в список не попадают. */
export function MovePageModal({ tree, pageId, onClose, onMove }: Props) {
  const targets = pageId
    ? flatten(tree.roots).filter((t) => canMove(tree, pageId, t.id))
    : [];

  return (
    <Modal
      opened={pageId !== null}
      onClose={onClose}
      title="Переместить страницу"
      size="sm"
    >
      <ScrollArea.Autosize mah={360}>
        <Stack gap={2}>
          <UnstyledButton
            onClick={() => onMove(null)}
            p={6}
            style={{ borderRadius: 4 }}
          >
            <Text size="sm" fw={500}>
              На верхний уровень
            </Text>
          </UnstyledButton>

          {targets.map((t) => (
            <UnstyledButton
              key={t.id}
              onClick={() => onMove(t.id)}
              p={6}
              pl={6 + t.depth * 14}
              style={{ borderRadius: 4 }}
            >
              <Text size="sm" truncate>
                {t.title || 'Без названия'}
              </Text>
            </UnstyledButton>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Modal>
  );
}
