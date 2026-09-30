import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { renderUI } from '../test/render';

const scheme = () => document.documentElement.getAttribute('data-mantine-color-scheme');

describe('ThemeToggle', () => {
  it('переключает тему туда и обратно и запоминает выбор', async () => {
    const user = userEvent.setup();
    renderUI(<ThemeToggle />);
    expect(scheme()).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Тёмная тема' }));
    expect(scheme()).toBe('dark');
    expect(window.localStorage.getItem('mantine-color-scheme-value')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Светлая тема' }));
    expect(scheme()).toBe('light');
    expect(window.localStorage.getItem('mantine-color-scheme-value')).toBe('light');
  });
});
