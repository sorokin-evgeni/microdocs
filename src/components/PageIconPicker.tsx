import { useState } from 'react';
import { Button, Popover, UnstyledButton } from '@mantine/core';
import { IconMoodSmile } from '@tabler/icons-react';
import {
  EmojiPicker,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from 'frimousse';
import classes from './PageIconPicker.module.css';

/**
 * Русские данные emojibase-data@17 лежат в public/: к чужому CDN не ходим.
 * Версия в пути — потому что сервер кеширует статику навсегда.
 */
const EMOJIBASE_URL = '/emojibase/17';

interface Props {
  icon: string | undefined;
  onChange: (icon: string | null) => void;
}

/** Иконка страницы перед названием и выбор эмодзи с поиском, как в Notion. */
export function PageIconPicker({ icon, onChange }: Props) {
  const [opened, setOpened] = useState(false);

  const choose = (next: string | null) => {
    onChange(next);
    setOpened(false);
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md" trapFocus>
      <Popover.Target>
        <UnstyledButton
          className={classes.trigger}
          data-empty={!icon || undefined}
          onClick={() => setOpened((value) => !value)}
          aria-label={icon ? 'Сменить иконку' : 'Добавить иконку'}
        >
          {icon ?? <IconMoodSmile size={24} stroke={1.5} />}
        </UnstyledButton>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <EmojiPicker.Root
          className={classes.root}
          locale="ru"
          emojibaseUrl={EMOJIBASE_URL}
          columns={9}
          onEmojiSelect={({ emoji }) => choose(emoji)}
        >
          <EmojiPicker.Search className={classes.search} placeholder="Поиск" />
          <EmojiPicker.Viewport className={classes.viewport}>
            <EmojiPicker.Loading className={classes.message}>Загрузка…</EmojiPicker.Loading>
            <EmojiPicker.Empty className={classes.message}>Ничего не нашлось</EmojiPicker.Empty>
            <EmojiPicker.List className={classes.list} components={{ CategoryHeader, Row, Emoji }} />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>

        {icon && (
          <Button variant="subtle" color="gray" size="compact-sm" fullWidth radius={0} onClick={() => choose(null)}>
            Убрать иконку
          </Button>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div className={classes.category} {...props}>
      {category.label}
    </div>
  );
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div className={classes.row} {...props}>
      {children}
    </div>
  );
}

function Emoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button className={classes.emoji} {...props}>
      {emoji.emoji}
    </button>
  );
}
