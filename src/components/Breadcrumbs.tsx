import { Fragment } from 'react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import type { PageId, TreeNode } from '../types';

interface Props {
  /** Предки открытой страницы от корня вниз, без неё самой. */
  trail: TreeNode[];
  onOpen: (id: PageId) => void;
}

/**
 * Путь к открытой странице — чтобы быстро подняться по дереву. Сама страница
 * в путь не входит: её название и так крупно ниже. На телефоне места мало,
 * там только прямой родитель, а выше — многоточие.
 */
export function Breadcrumbs({ trail, onOpen }: Props) {
  if (trail.length === 0) return null;
  const parent = trail[trail.length - 1]!;
  const path = trail.map(label).join(' / ');

  return (
    <nav className="page-breadcrumbs" aria-label="Путь к странице">
      <Box visibleFrom="sm" className="page-breadcrumbs-row">
        {trail.map((node, index) => (
          <Fragment key={node.id}>
            {index > 0 && <Separator />}
            <Crumb node={node} onOpen={onOpen} />
          </Fragment>
        ))}
      </Box>
      <Box hiddenFrom="sm" className="page-breadcrumbs-row">
        {trail.length > 1 && (
          <>
            <Text component="span" size="sm" c="dimmed" title={path} aria-label={path}>
              …
            </Text>
            <Separator />
          </>
        )}
        <Crumb node={parent} onOpen={onOpen} />
      </Box>
    </nav>
  );
}

function Crumb({ node, onOpen }: { node: TreeNode; onOpen: (id: PageId) => void }) {
  return (
    <UnstyledButton className="page-breadcrumb" onClick={() => onOpen(node.id)} title={label(node)}>
      {label(node)}
    </UnstyledButton>
  );
}

function Separator() {
  return (
    <Text component="span" size="sm" c="dimmed" aria-hidden className="page-breadcrumb-sep">
      /
    </Text>
  );
}

function label(node: TreeNode): string {
  const title = node.title || 'Без названия';
  return node.icon ? `${node.icon} ${title}` : title;
}
