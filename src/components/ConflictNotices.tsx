import { Anchor, Button, Group, Notification, Stack, Text } from '@mantine/core';
import type { PageId } from '../types';

export interface ConflictNotice {
  id: PageId;
  title: string;
}

interface Props {
  notices: ConflictNotice[];
  onOpen: (id: PageId) => void;
  onRestore: (id: PageId) => void;
  onDismiss: (id: PageId) => void;
}

/**
 * Неблокирующие уведомления сверху: страницу правили на другом устройстве
 * в том же месте, показана та версия. Своя не потеряна — её можно вернуть.
 */
export function ConflictNotices({ notices, onOpen, onRestore, onDismiss }: Props) {
  if (notices.length === 0) return null;

  return (
    <Stack
      gap="xs"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(440px, calc(100vw - 32px))',
        zIndex: 300,
      }}
    >
      {notices.map((notice) => (
        <Notification
          key={notice.id}
          color="yellow"
          withBorder
          onClose={() => onDismiss(notice.id)}
          closeButtonProps={{ 'aria-label': 'Оставить как есть' }}
          title={
            <Anchor component="button" type="button" fw={600} onClick={() => onOpen(notice.id)}>
              {notice.title || 'Без названия'}
            </Anchor>
          }
        >
          <Text size="sm">
            Страница изменена с другого устройства в том же месте, что и здесь. Показана та
            версия.
          </Text>
          <Group mt={6}>
            <Button size="compact-xs" variant="light" onClick={() => onRestore(notice.id)}>
              Вернуть мою версию
            </Button>
          </Group>
        </Notification>
      ))}
    </Stack>
  );
}
