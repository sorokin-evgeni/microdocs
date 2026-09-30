import type { ReactNode } from 'react';
import { Button, Group, TextInput } from '@mantine/core';
import { IconArchive, IconArrowsMove, IconPlus, IconTrash } from '@tabler/icons-react';
import { PageIconPicker } from './PageIconPicker';

interface Props {
  title: string;
  icon: string | undefined;
  onRename: (title: string) => void;
  onIconChange: (icon: string | null) => void;
  onCreateChild: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * Иконка над названием, название страницы и действия над ней. Те же действия
 * есть в меню строки дерева, здесь они всегда на виду.
 */
export function PageHeader(props: Props) {
  return (
    <div className="page-header">
      <PageIconPicker icon={props.icon} onChange={props.onIconChange} />
      <Group wrap="nowrap" gap="xs">
        <TextInput
          value={props.title}
          onChange={(event) => props.onRename(event.currentTarget.value)}
          placeholder="Без названия"
          variant="unstyled"
          classNames={{ input: 'page-title' }}
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Заголовок страницы"
        />
        <Group wrap="nowrap" gap={2}>
          <Action
            icon={<IconPlus size={15} />}
            label="Вложенная"
            name="Добавить вложенную"
            onClick={props.onCreateChild}
          />
          <Action icon={<IconArrowsMove size={15} />} label="Переместить" onClick={props.onMove} />
          <Action
            icon={<IconArchive size={15} />}
            label="В архив"
            name="Архивировать"
            onClick={props.onArchive}
          />
          <Action icon={<IconTrash size={15} />} label="Удалить" onClick={props.onDelete} />
        </Group>
      </Group>
    </div>
  );
}

interface ActionProps {
  icon: ReactNode;
  label: string;
  /** Полное имя для читалок: на узкой колонке подпись скрыта. */
  name?: string;
  onClick: () => void;
}

function Action({ icon, label, name = label, onClick }: ActionProps) {
  return (
    <Button
      variant="subtle"
      color="gray"
      c="dimmed"
      fw={500}
      size="compact-sm"
      px={6}
      onClick={onClick}
      aria-label={name}
    >
      {icon}
      <span className="page-action-label">{label}</span>
    </Button>
  );
}
