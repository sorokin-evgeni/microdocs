import DiffMatchPatch from 'diff-match-patch';

export type MergeResult = { clean: true; text: string } | { clean: false };

/** Правка базового текста: заменить [from, to) на `text`. Пустой интервал — вставка. */
interface Edit {
  from: number;
  to: number;
  text: string;
}

const dmp = new DiffMatchPatch();

/**
 * Трёхстороннее слияние текста: правки `mine` и `theirs` относительно общего
 * предка `base`. Сливается, только если они затрагивают разные места базы;
 * иначе — конфликт, и решать его не нам. Без предка слить нельзя.
 *
 * Правки обеих сторон накладываются на базу по позициям, без нечёткого
 * поиска: раз они не пересекаются, место каждой известно точно.
 */
export function merge3(base: string | null, mine: string, theirs: string): MergeResult {
  if (mine === theirs) return { clean: true, text: theirs };
  if (base === null) return { clean: false };
  if (mine === base) return { clean: true, text: theirs };
  if (theirs === base) return { clean: true, text: mine };

  const a = edits(base, mine);
  const b = edits(base, theirs);
  if (overlaps(a, b)) return { clean: false };

  // Вставка раньше замены, начинающейся в той же точке: иначе вставка
  // оказалась бы внутри заменённого.
  const all = [...a, ...b].sort((x, y) => x.from - y.from || (x.to - x.from) - (y.to - y.from));
  let text = '';
  let at = 0;
  for (const edit of all) {
    text += base.slice(at, edit.from) + edit.text;
    at = edit.to;
  }
  return { clean: true, text: text + base.slice(at) };
}

/** Какие места базы правка затрагивает и чем их заменяет. */
function edits(base: string, changed: string): Edit[] {
  const diffs = dmp.diff_main(base, changed);
  dmp.diff_cleanupSemantic(diffs);

  const result: Edit[] = [];
  let at = 0;
  let open: Edit | null = null;
  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      if (open) result.push(open);
      open = null;
      at += text.length;
      continue;
    }
    open ??= { from: at, to: at, text: '' };
    if (op === DiffMatchPatch.DIFF_DELETE) {
      at += text.length;
      open.to = at;
    } else {
      open.text += text;
    }
  }
  if (open) result.push(open);
  return result;
}

/**
 * Пересекаются ли правки. Соприкасаться можно: правка до слова и правка
 * после него — разные места. Нельзя: общие символы базы, вставка внутрь
 * чужой замены и две вставки в одну точку — порядок в них не угадать.
 */
function overlaps(a: Edit[], b: Edit[]): boolean {
  return a.some((x) =>
    b.some((y) => {
      const xInsert = x.from === x.to;
      const yInsert = y.from === y.to;
      if (xInsert && yInsert) return x.from === y.from;
      if (xInsert) return y.from < x.from && x.from < y.to;
      if (yInsert) return x.from < y.from && y.from < x.to;
      return x.from < y.to && y.from < x.to;
    }),
  );
}
