import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { renderUI } from '../test/render';
import { NavbarResizer, useNavbarWidth } from './NavbarResizer';

beforeEach(() => {
  window.localStorage.clear();
  // jsdom не умеет захват указателя.
  Element.prototype.setPointerCapture = vi.fn();
});

describe('NavbarResizer', () => {
  it('ширина идёт за курсором, пока кнопка зажата, и не выходит за пределы', () => {
    const onResize = vi.fn();
    renderUI(<NavbarResizer onResize={onResize} />);
    const handle = screen.getByRole('separator', { name: 'Ширина списка страниц' });

    fireEvent.pointerMove(handle, { clientX: 400 });
    expect(onResize).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { button: 0, clientX: 260 });
    fireEvent.pointerMove(handle, { clientX: 400 });
    fireEvent.pointerMove(handle, { clientX: 50 });
    fireEvent.pointerMove(handle, { clientX: 5000 });
    expect(onResize.mock.calls).toEqual([[400], [200], [600]]);

    fireEvent.pointerUp(handle);
    fireEvent.pointerMove(handle, { clientX: 300 });
    expect(onResize).toHaveBeenCalledTimes(3);
  });
});

describe('useNavbarWidth', () => {
  it('по умолчанию 260', () => {
    const { result } = renderHook(() => useNavbarWidth());
    expect(result.current[0]).toBe(260);
  });

  it('выставленная ширина переживает перезагрузку', () => {
    const first = renderHook(() => useNavbarWidth());
    act(() => first.result.current[1](420));
    first.unmount();

    const second = renderHook(() => useNavbarWidth());
    expect(second.result.current[0]).toBe(420);
  });

  it('мусор в хранилище не ломает ширину', () => {
    window.localStorage.setItem('microdocs:navbar-width', 'abc');
    expect(renderHook(() => useNavbarWidth()).result.current[0]).toBe(260);

    window.localStorage.setItem('microdocs:navbar-width', '99999');
    expect(renderHook(() => useNavbarWidth()).result.current[0]).toBe(600);
  });
});
