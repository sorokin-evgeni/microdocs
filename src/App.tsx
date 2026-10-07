import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Button,
  Group,
  Loader,
  ScrollArea,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';

import { createIndexedDbStore } from './storage/indexedDbStore';
import { createRemoteStore } from './storage/remoteStore';
import { createOutbox } from './storage/outbox';
import { createSyncingStore, type SyncState } from './storage/syncingStore';
import { createRescues } from './storage/rescues';
import { useBase } from './state/useBase';
import { usePageBody } from './state/usePageBody';
import { useAppUpdate } from './state/useAppUpdate';
import { initialPage, usePageUrl } from './state/usePageUrl';
import { PageTree } from './components/PageTree';
import { MovePageModal } from './components/MovePageModal';
import { NavbarResizer, useNavbarWidth } from './components/NavbarResizer';
import { PageHeader } from './components/PageHeader';
import { Breadcrumbs } from './components/Breadcrumbs';
import { ThemeToggle } from './components/ThemeToggle';
import { Brand } from './components/Brand';
import { ArchiveSection } from './components/ArchiveSection';
import { ConflictNotices } from './components/ConflictNotices';
import { PullIndicator } from './components/PullIndicator';
import { usePullToRefresh } from './state/usePullToRefresh';
import { Editor } from './components/Editor';
import { ancestorIds, findNode, subtreeIds } from './domain/tree';
import type { PageId, TreeNode } from './types';

/**
 * Имя локального кеша в этом браузере. На сервере база определяется
 * клиентским сертификатом и в запросах не называется.
 */
const LOCAL_CACHE_ID = 'default';

export function App() {
  const [syncState, setSyncState] = useState<SyncState>('синхронизировано');

  // Новая версия приложения перестраивает локальную базу; пока в другой
  // вкладке открыта старая, перестройка ждёт — без объяснения это пустой экран.
  const [dbBlocked, setDbBlocked] = useState(false);

  const rescues = useMemo(() => createRescues(LOCAL_CACHE_ID), []);
  const store = useMemo(
    () =>
      createSyncingStore({
        local: createIndexedDbStore(LOCAL_CACHE_ID, {
          onBlockedChange: setDbBlocked,
          // Мешаем новой версии в другой вкладке — уступаем: перезагрузка
          // поднимет новую и здесь. Недописанное уйдёт в базу по pagehide.
          onBlocking: () => window.location.reload(),
        }),
        remote: createRemoteStore(),
        outbox: createOutbox(LOCAL_CACHE_ID),
        rescues,
        onState: setSyncState,
      }),
    [rescues],
  );

  // Свои версии, проигравшие конфликт. Переживают перезагрузку — поэтому
  // начальный список берётся из хранилища, а не только из событий.
  const [rescued, setRescued] = useState(() => rescues.list());
  useEffect(
    () =>
      store.subscribe((change) => {
        if (change.conflict) setRescued(rescues.list());
      }),
    [store, rescues],
  );

  // Связь вернулась — досылаем накопившееся (FR-32).
  // Ушли в фон или закрываемся — отправляем без отсрочки: таймер может не дожить.
  useEffect(() => {
    const drain = () => void store.drain();
    const onVisibility = () => store.setBackground(document.visibilityState === 'hidden');
    const onPageHide = () => store.setBackground(true);
    // Возврат из кеша страниц браузера (bfcache) — снова на переднем плане.
    const onPageShow = () => store.setBackground(false);
    window.addEventListener('online', drain);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('online', drain);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [store]);

  const base = useBase(store, initialPage);
  usePageUrl(base.tree, base.selectedId, base.select);
  const page = usePageBody(
    store,
    base.selectedId,
    (base.tree && base.selectedId && findNode(base.tree, base.selectedId)?.children.map((c) => c.id)) || [],
  );
  // Потянули вниз в самом верху страницы — сверяемся с сервером: дерево,
  // открытая страница, досылка неотправленного, новая версия приложения.
  // Не меньше полсекунды, иначе кружок мелькнёт и непонятно, было ли что.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      store.refreshTree(),
      base.selectedId ? store.refreshPage(base.selectedId) : null,
      store.drain(),
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  }, [store, base.selectedId]);
  // Список страниц и открытые окна прокручиваются сами — жест там не наш.
  const pull = usePullToRefresh(refreshAll, (target) =>
    Boolean(target.closest('.mantine-AppShell-navbar, [role="dialog"], [data-portal]')),
  );

  const [navOpened, { toggle: toggleNav, close: closeNav }] =
    useDisclosure(false);
  const [movingId, setMovingId] = useState<PageId | null>(null);
  const [navWidth, setNavWidth] = useNavbarWidth();
  const applyUpdate = useAppUpdate();

  const selected =
    base.tree && base.selectedId ? findNode(base.tree, base.selectedId) : null;

  const handleSelect = (id: PageId) => {
    base.select(id);
    closeNav();
  };

  // Корень базы — её первая страница, как при заходе на «/».
  const handleOpenRoot = () => {
    const first = base.tree?.roots[0];
    if (first) handleSelect(first.id);
  };

  const handleOpenPage = (id: PageId) => {
    if (base.tree && findNode(base.tree, id)) handleSelect(id);
    else if (base.tree?.archive?.some((e) => subtreeIds(e.node).includes(id)))
      window.alert('Страница, на которую ведёт ссылка, в архиве.');
    else window.alert('Страницы, на которую ведёт ссылка, больше нет.');
  };

  const handleDelete = (id: PageId) => {
    if (!base.tree) return;
    const node = findNode(base.tree, id);
    if (!node) return;
    if (window.confirm(deleteQuestion(node))) void base.deletePage(id);
  };

  // Архивирование — без подтверждения: страницу можно вернуть. Удаление из архива — с ним.
  const handleDeleteArchived = (id: PageId) => {
    const node = base.tree?.archive?.find((e) => e.node.id === id)?.node;
    if (node && window.confirm(deleteQuestion(node, ' насовсем'))) void base.deleteArchivedPage(id);
  };

  return (
    <AppShell
      // Полоса сверху только на телефоне: там список страниц спрятан, и нужна кнопка,
      // чтобы его открыть. На компьютере страница начинается с самого верха.
      header={{ height: { base: 40, sm: 0 } }}
      navbar={{
        width: navWidth,
        breakpoint: 'sm',
        collapsed: { mobile: !navOpened },
      }}
      padding={0}
    >
      <AppShell.Header hiddenFrom="sm">
        <Group h="100%" px="sm" gap="sm">
          <Burger opened={navOpened} onClick={toggleNav} size="sm" aria-label="Меню" />
          <Brand onOpenRoot={handleOpenRoot} />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={6}>
        {/* Шапка списка страниц. На телефоне вместо неё полоса сверху. */}
        <Box visibleFrom="sm" h={40} px={4}>
          <Brand onOpenRoot={handleOpenRoot} />
        </Box>

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
              onArchive={(id) => void base.archivePage(id)}
              onMoveRequest={setMovingId}
              onShift={(id, delta) => void base.shiftPage(id, delta)}
              onPlace={(id, targetId, position) => void base.placePage(id, targetId, position)}
            />
          )}
        </ScrollArea>

        {base.tree?.archive && (
          <ArchiveSection
            archive={base.tree.archive}
            onRestore={(id) => void base.restorePage(id)}
            onDelete={handleDeleteArchived}
          />
        )}

        <Group justify="space-between" px={4} pt={4} wrap="nowrap">
          <Text
            size="xs"
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
          <Group gap={4} wrap="nowrap">
            {applyUpdate && (
              <Button size="compact-xs" variant="light" onClick={applyUpdate}>
                Обновить
              </Button>
            )}
            <ThemeToggle />
          </Group>
        </Group>

        <NavbarResizer onResize={setNavWidth} />
      </AppShell.Navbar>

      <AppShell.Main>
        <PullIndicator {...pull} />
        {page.refreshing && (
          <Group
            gap={6}
            wrap="nowrap"
            style={{ position: 'fixed', top: 10, right: 14, zIndex: 200, pointerEvents: 'none' }}
          >
            <Loader size={12} color="gray" />
            <Text size="xs" c="dimmed">
              Обновляется…
            </Text>
          </Group>
        )}
        {selected ? (
          <div className="page-column">
            <Breadcrumbs
              trail={ancestorIds(base.tree!, selected.id).flatMap((id) => findNode(base.tree!, id) ?? [])}
              onOpen={handleSelect}
            />
            <PageHeader
              title={selected.title}
              icon={selected.icon}
              onRename={(title) => base.renamePage(selected.id, title)}
              onIconChange={(icon) => base.setPageIcon(selected.id, icon)}
              onCreateChild={() => void base.createPage(selected.id)}
              onMove={() => setMovingId(selected.id)}
              onArchive={() => base.archivePage(selected.id)}
              onDelete={() => handleDelete(selected.id)}
            />
            {page.body !== null && (
              <Editor
                pageId={selected.id}
                body={page.body}
                revision={page.revision}
                onChange={page.change}
                onOpenPage={handleOpenPage}
              />
            )}
          </div>
        ) : dbBlocked ? (
          <Text size="sm" c="dimmed" p="md">
            Ждём локальную базу. Если microdocs открыт в другой вкладке или окне — там,
            скорее всего, прежняя версия. Закройте её, эта загрузится сама.
          </Text>
        ) : base.unavailable ? (
          <Text size="sm" c="dimmed" p="md">
            Нет связи, а на этом устройстве базы ещё нет. Загрузится, когда связь
            появится.
          </Text>
        ) : base.tree ? (
          <Text size="sm" c="dimmed" p="md">
            Выбери страницу слева или создай новую.
          </Text>
        ) : null}
      </AppShell.Main>

      <ConflictNotices
        notices={rescued.map((r) => ({
          id: r.id,
          title: (base.tree && findNode(base.tree, r.id)?.title) ?? '',
        }))}
        onOpen={handleOpenPage}
        onRestore={(id) => {
          void store.restoreRescue(id);
          setRescued(rescues.list().filter((r) => r.id !== id));
        }}
        onDismiss={(id) => {
          store.dismissRescue(id);
          setRescued(rescues.list());
        }}
      />

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

/** Про вложенные страницы предупреждаем отдельно: уйдут вместе со страницей. */
function deleteQuestion(node: TreeNode, how = ''): string {
  const title = node.title || 'Без названия';
  return node.children.length > 0
    ? `Удалить «${title}»${how} вместе с вложенными страницами?`
    : `Удалить «${title}»${how}?`;
}
