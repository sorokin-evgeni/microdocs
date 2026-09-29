import { useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { PageId } from '../types';
import { editorExtensions, followLink } from './editorSetup';

interface Props {
  /** Смена страницы пересоздаёт редактор, чтобы не смешивать содержимое. */
  pageId: PageId;
  body: string;
  onChange: (markdown: string) => void;
  /** Переход по ссылке на другую страницу базы. */
  onOpenPage: (id: PageId) => void;
}

/**
 * Редактор показывает готовый текст, а хранит Markdown (FR-19).
 * Разметка применяется по ходу набора силами StarterKit (FR-20).
 */
export function Editor({ pageId, body, onChange, onOpenPage }: Props) {
  // Редактор создаётся раз на страницу, а обработчик у родителя может смениться.
  const openPage = useRef(onOpenPage);
  openPage.current = onOpenPage;

  const editor = useEditor(
    {
      extensions: editorExtensions(),
      content: body,
      onUpdate: ({ editor }) => onChange(readMarkdown(editor)),
      editorProps: {
        handleDOMEvents: {
          click: (_view, event) => followLink(event, (id) => openPage.current(id)),
        },
      },
    },
    [pageId],
  );

  return (
    <div className="md-editor">
      <EditorContent editor={editor} />
    </div>
  );
}

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

function readMarkdown(editor: { storage: unknown }): string {
  return (editor.storage as MarkdownStorage).markdown.getMarkdown();
}
