import {
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconLetterT,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconQuote,
  IconSeparatorHorizontal,
  IconTable,
} from '@tabler/icons-react';

/** Значки типов блоков — общие для ручки и слэш-меню. */
export const BLOCK_ICONS: Record<string, typeof IconH1> = {
  paragraph: IconLetterT,
  h1: IconH1,
  h2: IconH2,
  h3: IconH3,
  bulletList: IconList,
  orderedList: IconListNumbers,
  taskList: IconListCheck,
  blockquote: IconQuote,
  codeBlock: IconCode,
  table: IconTable,
  horizontalRule: IconSeparatorHorizontal,
};
