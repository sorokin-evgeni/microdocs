import { createTheme } from '@mantine/core';

/**
 * Плотная техничная тема: мельче базовый шрифт и отступы, чем у Mantine
 * по умолчанию, чтобы в дереве помещалось больше страниц.
 */
export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'sm',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  fontSizes: {
    xs: '11px',
    sm: '13px',
    md: '14px',
    lg: '16px',
    xl: '18px',
  },
  spacing: {
    xs: '6px',
    sm: '10px',
    md: '14px',
    lg: '18px',
    xl: '24px',
  },
  components: {
    Button: { defaultProps: { size: 'xs' } },
    TextInput: { defaultProps: { size: 'xs' } },
  },
});
