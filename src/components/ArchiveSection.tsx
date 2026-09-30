import { ActionIcon, Box, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowBackUp,
  IconChevronDown,
  IconChevronRight,
  IconTrash,
} from '@tabler/icons-react';
import type { ArchivedNode, PageId } from '../types';
import { PageGlyph } from './PageTree';

interface Props {
  archive: ArchivedNode[];
  onRestore: (id: PageId) => void;
  onDelete: (id: PageId) => void;
}

/**
 * Архив внизу списка страниц. Свёрнут, пока не откроешь; пустой не показывается.
 * Страницы в нём не открываются — только возвращаются на место или удаляются.
 */
export function ArchiveSection({ archive, onRestore, onDelete }: Props) {
  const [opened, { toggle }] = useDisclosure(false);
  if (archive.length === 0) return null;

  // Свежие сверху: только что убранное ищут первым.
  const entries = [...archive].reverse();

  return (
    <Box pt={4}>
      <UnstyledButton onClick={toggle} px={4} py={2} aria-expanded={opened}>
        <Group gap={4} wrap="nowrap">
          {opened ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Архив · {archive.length}
          </Text>
        </Group>
      </UnstyledButton>

      {opened && (
        <ScrollArea.Autosize mah="40vh" type="hover">
          <Stack gap={2}>
            {entries.map(({ node }) => {
              const title = node.title || 'Без названия';
              return (
                <Group key={node.id} gap={4} wrap="nowrap" pl={6} pr={6}>
                  {/* Слот стрелки и зазоры как у строк дерева: названия стоят на одной линии. */}
                  <Box w={20} style={{ flexShrink: 0 }} />
                  <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <PageGlyph icon={node.icon} />
                    <Text size="md" c="dimmed" truncate py={4} style={{ flex: 1, minWidth: 0 }}>
                      {title}
                    </Text>
                  </Group>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size={20}
                    onClick={() => onRestore(node.id)}
                    aria-label={`Восстановить: ${title}`}
                    title="Восстановить"
                  >
                    <IconArrowBackUp size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size={20}
                    onClick={() => onDelete(node.id)}
                    aria-label={`Удалить насовсем: ${title}`}
                    title="Удалить насовсем"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Box>
  );
}
