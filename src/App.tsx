import { AppShell, Burger, Group, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

export function App() {
  const [navOpened, { toggle: toggleNav }] = useDisclosure(false);

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
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Text size="xs" c="dimmed">
          Дерево страниц
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Text size="sm" p="md">
          Редактор
        </Text>
      </AppShell.Main>
    </AppShell>
  );
}
