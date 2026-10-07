import { Extension, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { filterBlockTypes, type BlockType } from './blockTypes';

/** Что показывает слэш-меню. `null` — закрыто. */
export interface SlashState {
  items: BlockType[];
  selected: number;
  /** Где курсор — меню встаёт под ним. */
  rect: DOMRect | null;
  choose: (item: BlockType) => void;
}

/**
 * Состояние слэш-меню между плагином редактора и React: плагин пишет,
 * компонент подписывается. Стрелки и Enter обрабатываются здесь же —
 * плагин спрашивает до того, как клавишу получит редактор. Esc закрывает
 * меню сам плагин: до следующего «/» оно не вернётся.
 */
export class SlashController {
  private state: SlashState | null = null;
  private props: SuggestionProps<BlockType, BlockType> | null = null;
  private listeners = new Set<() => void>();

  get = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: SlashState | null) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }

  start(props: SuggestionProps<BlockType, BlockType>) {
    this.update(props);
  }

  update(props: SuggestionProps<BlockType, BlockType>) {
    this.props = props;
    // Список подбирается асинхронно; пока подбирается — показываем прежний.
    if (props.loading) return;
    if (props.items.length === 0) {
      this.set(null);
      return;
    }
    // Список сменился — выбор на первый пункт; иначе держим.
    const keep = this.state && this.state.items === props.items ? this.state.selected : 0;
    this.set({
      items: props.items,
      selected: Math.min(keep, props.items.length - 1),
      rect: props.clientRect?.() ?? null,
      choose: (item) => props.command(item),
    });
  }

  exit() {
    this.props = null;
    this.set(null);
  }

  /** true — клавиша обработана меню и редактору не нужна. */
  keyDown(event: KeyboardEvent): boolean {
    const state = this.state;
    if (!state || !this.props) return false;
    const n = state.items.length;
    switch (event.key) {
      case 'ArrowDown':
        this.set({ ...state, selected: (state.selected + 1) % n });
        return true;
      case 'ArrowUp':
        this.set({ ...state, selected: (state.selected - 1 + n) % n });
        return true;
      case 'Enter':
      case 'Tab': {
        const item = state.items[state.selected];
        if (item) state.choose(item);
        return true;
      }
      default:
        return false;
    }
  }

  select(index: number) {
    if (this.state) this.set({ ...this.state, selected: index });
  }
}

/**
 * «/» в начале строки или после пробела открывает меню блоков. Набранное
 * после «/» фильтрует список; выбор стирает «/запрос» и превращает строку.
 * В коде «/» — просто символ.
 */
export function slashCommand(controller: SlashController) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<BlockType, BlockType>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommand'),
          char: '/',
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            if ($from.parent.type.spec.code) return false;
            const code = state.schema.marks.code;
            return !code || !state.doc.rangeHasMark(range.from, range.to, code);
          },
          items: ({ query }) => filterBlockTypes(query),
          command: ({ editor, range, props }) => runBlockType(editor, range, props),
          render: () => ({
            onStart: (props) => controller.start(props),
            onUpdate: (props) => controller.update(props),
            onExit: () => controller.exit(),
            onKeyDown: ({ event }) => controller.keyDown(event),
          }),
        }),
      ];
    },
  });
}

/** Стереть «/запрос» и применить тип к строке, где он был. */
export function runBlockType(editor: Editor, range: { from: number; to: number }, type: BlockType) {
  type.apply(editor.chain().focus().deleteRange(range)).run();
}
