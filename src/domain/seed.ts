import type { PageId, Tree } from '../types';
import { makeNode } from './tree';

/** Стартовое наполнение, чтобы пустая база не встречала пользователя пустотой. */
export function seedBase(): { tree: Tree; bodies: Record<PageId, string> } {
  const welcome = makeNode('Добро пожаловать');
  const howto = makeNode('Как это устроено');
  const next = makeNode('Что дальше');
  const notes = makeNode('Заметки');

  welcome.children = [howto, next];

  return {
    tree: { roots: [welcome, notes] },
    bodies: {
      [welcome.id]:
        '# Своя вики\n\n' +
        'Слева дерево страниц, справа текст. Всё сохраняется само.\n\n' +
        'Попробуй набрать `# ` в начале строки — получится заголовок.\n',
      [howto.id]:
        '## Разметка\n\n' +
        'Форматирование применяется по ходу набора:\n\n' +
        '- `# ` — заголовок\n' +
        '- `- ` — список\n' +
        '- `> ` — цитата\n' +
        '- ```` ``` ```` — блок кода\n\n' +
        '> Текст хранится как Markdown, а показывается уже готовым.\n',
      [next.id]:
        '## Чего пока нет\n\n' +
        'Синхронизации с сервером, истории версий, поиска и картинок.\n' +
        'Это следующие шаги.\n',
      [notes.id]: '',
    },
  };
}
