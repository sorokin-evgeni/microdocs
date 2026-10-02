import { describe, expect, it } from 'vitest';
import { merge3 } from './merge';

const base = [
  '# Поездка',
  '',
  'Билеты купить до пятницы.',
  '',
  'Взять зарядку и паспорт.',
  '',
  'Отель забронирован.',
].join('\n');

describe('трёхстороннее слияние', () => {
  it('правки в разных местах сливаются', () => {
    const mine = base.replace('до пятницы', 'до четверга');
    const theirs = base.replace('Отель забронирован.', 'Отель забронирован, оплачен.');
    const result = merge3(base, mine, theirs);
    expect(result).toEqual({
      clean: true,
      text: base
        .replace('до пятницы', 'до четверга')
        .replace('Отель забронирован.', 'Отель забронирован, оплачен.'),
    });
  });

  it('дописанный в конец абзац и правка сверху сливаются', () => {
    const mine = `${base}\n\nНе забыть страховку.`;
    const theirs = base.replace('# Поездка', '# Поездка в Казань');
    const result = merge3(base, mine, theirs);
    expect(result).toEqual({
      clean: true,
      text: `${base.replace('# Поездка', '# Поездка в Казань')}\n\nНе забыть страховку.`,
    });
  });

  it('одно и то же место изменено по-разному — конфликт', () => {
    const mine = base.replace('до пятницы', 'до четверга');
    const theirs = base.replace('до пятницы', 'до субботы');
    expect(merge3(base, mine, theirs)).toEqual({ clean: false });
  });

  it('две вставки в одну точку — конфликт', () => {
    const mine = `${base}\nмоё`;
    const theirs = `${base}\nчужое`;
    expect(merge3(base, mine, theirs)).toEqual({ clean: false });
  });

  it('вставка внутрь удалённого другой стороной — конфликт', () => {
    const mine = base.replace('зарядку и паспорт', 'зарядку, наушники и паспорт');
    const theirs = base.replace('\n\nВзять зарядку и паспорт.', '');
    expect(merge3(base, mine, theirs)).toEqual({ clean: false });
  });

  it('одинаковые правки — не конфликт', () => {
    const same = base.replace('до пятницы', 'до четверга');
    expect(merge3(base, same, same)).toEqual({ clean: true, text: same });
  });

  it('правила только одна сторона — берётся её текст', () => {
    const mine = base.replace('паспорт', 'загранпаспорт');
    expect(merge3(base, mine, base)).toEqual({ clean: true, text: mine });
    expect(merge3(base, base, mine)).toEqual({ clean: true, text: mine });
  });

  it('без общего предка слить нельзя, если тексты разные', () => {
    expect(merge3(null, 'моё', 'чужое')).toEqual({ clean: false });
    expect(merge3(null, 'то же', 'то же')).toEqual({ clean: true, text: 'то же' });
  });

  it('правки вплотную друг к другу сливаются', () => {
    expect(merge3('abc def ghi', 'abc XYZ ghi', 'abc def new ghi')).toEqual({
      clean: true,
      text: 'abc XYZ new ghi',
    });
    expect(merge3('abc def ghi', 'abc XYZ ghi', 'abc new def ghi')).toEqual({
      clean: true,
      text: 'abc new XYZ ghi',
    });
  });
});
