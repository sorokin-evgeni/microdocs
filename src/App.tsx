import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  ScrollArea,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';

import { createIndexedDbStore } from './storage/indexedDbStore';
import { createRemoteStore } from './storage/remoteStore';
import { createOutbox } from './storage/outbox';
import { createSyncingStore, type SyncState } from './storage/syncingStore';
import { useBase } from './state/useBase';
import { usePageBody } from './state/usePageBody';
import { pageFromLocation, usePageUrl } from './state/usePageUrl';
import { PageTree } from './components/PageTree';
import { MovePageModal } from './components/MovePageModal';
import { Editor } from './components/Editor';
import { findNode } from './domain/tree';
import type { PageId } from './types';

/**
 * Имя локального кеша в этом браузере. На сервере база определяется
 * клиентским сертификатом и в запросах не называется.
 */
const LOCAL_CACHE_ID = 'default';

export function App() {
  const [syncState, setSyncState] = useState<SyncState>('синхронизировано');

  const store = useMemo(
    () =>
      createSyncingStore(
        createIndexedDbStore(LOCAL_CACHE_ID),
        createRemoteStore(),
        createOutbox(LOCAL_CACHE_ID),
        setSyncState,
      ),
    [],
  );

  // Связь вернулась — досылаем накопившееся (FR-32).
  useEffect(() => {
    const drain = () => void store.drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
  }, [store]);

  const base = useBase(store, pageFromLocation);
  usePageUrl(base.tree, base.selectedId, base.select);
  const page = usePageBody(store, base.selectedId);
  const [navOpened, { toggle: toggleNav, close: closeNav }] =
    useDisclosure(false);
  const [movingId, setMovingId] = useState<PageId | null>(null);

  const selected =
    base.tree && base.selectedId ? findNode(base.tree, base.selectedId) : null;

  const handleSelect = (id: PageId) => {
    base.select(id);
    closeNav();
  };

  const handleOpenPage = (id: PageId) => {
    if (base.tree && findNode(base.tree, id)) handleSelect(id);
    else window.alert('Страницы, на которую ведёт ссылка, больше нет.');
  };

  const handleDelete = (id: PageId) => {
    if (!base.tree) return;
    const node = findNode(base.tree, id);
    if (!node) return;
    const title = node.title || 'Без названия';
    const question =
      node.children.length > 0
        ? `Удалить «${title}» вместе с вложенными страницами?`
        : `Удалить «${title}»?`;
    if (window.confirm(question)) void base.deletePage(id);
  };

  return (
    <AppShell
      header={{ height: 40 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: !navOpened },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="sm" gap="sm">
          <Burger
            opened={navOpened}
            onClick={toggleNav}
            hiddenFrom="sm"
            size="sm"
            aria-label="Меню"
          />
          <Text size="sm" fw={600}>
            microdocs
          </Text>
          <Text
            size="xs"
            ml="auto"
            c={
              syncState === 'нет связи'
                ? 'red'
                : syncState === 'ожидает отправки'
                  ? 'yellow'
                  : 'dimmed'
            }
          >
            {syncState}
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={6}>
        <Group justify="space-between" px={4} pb={4} wrap="nowrap">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Страницы
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={20}
            onClick={() => void base.createPage(null)}
            aria-label="Новая страница"
          >
            <IconPlus size={14} />
          </ActionIcon>
        </Group>

        <ScrollArea style={{ flex: 1 }} type="hover">
          {base.tree && (
            <PageTree
              tree={base.tree}
              selectedId={base.selectedId}
              onSelect={handleSelect}
              onCreateChild={(parentId) => void base.createPage(parentId)}
              onDelete={handleDelete}
              onMoveRequest={setMovingId}
              onShift={(id, delta) => void base.shiftPage(id, delta)}
            />
          )}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        {selected ? (
          <div className="page-column">
            <TextInput
              value={selected.title}
              onChange={(event) =>
                base.renamePage(selected.id, event.currentTarget.value)
              }
              placeholder="Без названия"
              variant="unstyled"
              classNames={{ input: 'page-title' }}
              aria-label="Заголовок страницы"
            />
            {page.body !== null && (
              <Editor
                pageId={selected.id}
                body={page.body}
                onChange={page.change}
                onOpenPage={handleOpenPage}
              />
            )}
          </div>
        ) : (
          <Text size="sm" c="dimmed" p="md">
            Выбери страницу слева или создай новую.
          </Text>
        )}
      </AppShell.Main>

      {base.tree && (
        <MovePageModal
          tree={base.tree}
          pageId={movingId}
          onClose={() => setMovingId(null)}
          onMove={(newParentId) => {
            if (movingId) void base.movePage(movingId, newParentId);
            setMovingId(null);
          }}
        />
      )}
    </AppShell>
  );
}
