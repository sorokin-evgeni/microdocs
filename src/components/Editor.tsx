import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { PageId } from '../types';
import { editorExtensions, followLink } from './editorSetup';

interface Props {
  /** Смена страницы пересоздаёт редактор, чтобы не смешивать содержимое. */
  pageId: PageId;
  body: string;
  /**
   * Растёт, когда текст поменялся не из редактора (пришёл с другого устройства):
   * тогда содержимое подменяется на `body`. Обычные правки его не трогают.
   */
  revision?: number;
  onChange: (markdown: string) => void;
  /** Переход по ссылке на другую страницу базы. */
  onOpenPage: (id: PageId) => void;
}

/**
 * Редактор показывает готовый текст, а хранит Markdown (FR-19).
 * Разметка применяется по ходу набора силами StarterKit (FR-20).
 */
export function Editor({ pageId, body, revision = 0, onChange, onOpenPage }: Props) {
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

  // Подмена без события обновления: это не правка, писать её обратно незачем.
  // Курсор остаётся на том же смещении, насколько позволяет новая длина.
  const shownRevision = useRef(revision);
  useEffect(() => {
    if (!editor || revision === shownRevision.current) return;
    shownRevision.current = revision;
    if (readMarkdown(editor) === body) return;
    const { from } = editor.state.selection;
    editor.commands.setContent(body, { emitUpdate: false });
    editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size - 1));
  }, [editor, revision, body]);

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
