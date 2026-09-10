import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Typography } from '@mantine/core';
import type { PageId } from '../types';
import './editor.css';

interface Props {
  /** Смена страницы пересоздаёт редактор, чтобы не смешивать содержимое. */
  pageId: PageId;
  body: string;
  onChange: (markdown: string) => void;
}

/**
 * Редактор показывает готовый текст, а хранит Markdown (FR-19).
 * Разметка применяется по ходу набора силами StarterKit (FR-20).
 */
export function Editor({ pageId, body, onChange }: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Markdown.configure({
          html: false,
          // Неподдерживаемое не выбрасываем, а оставляем в исходнике (FR-23).
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: body,
      onUpdate: ({ editor }) => onChange(readMarkdown(editor)),
    },
    [pageId],
  );

  return (
    <Typography className="md-editor">
      <EditorContent editor={editor} />
    </Typography>
  );
}

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

function readMarkdown(editor: { storage: unknown }): string {
  return (editor.storage as MarkdownStorage).markdown.getMarkdown();
}
