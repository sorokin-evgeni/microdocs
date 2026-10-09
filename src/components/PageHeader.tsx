import type { ReactNode } from 'react';
import { ActionIcon, Button, Group, Menu, TextInput } from '@mantine/core';
import { IconArchive, IconArrowsMove, IconDots, IconPlus, IconTrash } from '@tabler/icons-react';
import { PageIconPicker } from './PageIconPicker';

interface Props {
  title: string;
  icon: string | undefined;
  onRename: (title: string) => void;
  /** Enter в названии: перейти к тексту страницы. */
  onEnter?: () => void;
  onIconChange: (icon: string | null) => void;
  onCreateChild: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * Иконка над названием, название страницы и действия над ней. На виду —
 * частые («Вложенная», «В архив»), остальные — в меню за троеточием,
 * чтобы длинному названию хватало места.
 */
export function PageHeader(props: Props) {
  return (
    <div className="page-header">
      <PageIconPicker icon={props.icon} onChange={props.onIconChange} />
      <Group wrap="nowrap" gap="xs">
        <TextInput
          value={props.title}
          onChange={(event) => props.onRename(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !props.onEnter) return;
            event.preventDefault();
            props.onEnter();
          }}
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
          <Action
            icon={<IconArchive size={15} />}
            label="В архив"
            name="Архивировать"
            onClick={props.onArchive}
          />
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" c="dimmed" size={26} aria-label="Ещё действия">
                <IconDots size={15} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconArrowsMove size={13} />} onClick={props.onMove}>
                Переместить…
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={13} />} onClick={props.onDelete}>
                Удалить
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
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
