import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { neutral, previewPalettes, ThemeProvider } from '@/design';

import { Text } from './Text';

const palette = previewPalettes.sonOfSpergy;

const renderThemed = (ui: ReactElement) =>
  render(<ThemeProvider initialPalette={palette}>{ui}</ThemeProvider>);

describe('Text', () => {
  it('defaults to the body style in the text color', async () => {
    await renderThemed(<Text>Hello</Text>);
    expect(screen.getByText('Hello')).toHaveStyle({
      fontFamily: 'Geist-Regular',
      fontSize: 15,
      color: neutral.text,
    });
  });

  it('applies the requested variant', async () => {
    await renderThemed(<Text variant="hero">Big</Text>);
    expect(screen.getByText('Big')).toHaveStyle({ fontFamily: 'Geist-SemiBold', fontSize: 36 });
  });

  it('resolves now-playing color tokens from the theme', async () => {
    await renderThemed(<Text color="accent">Accent</Text>);
    expect(screen.getByText('Accent')).toHaveStyle({ color: palette.accent });
  });

  it('passes other color strings through', async () => {
    await renderThemed(<Text color="#123456">Raw</Text>);
    expect(screen.getByText('Raw')).toHaveStyle({ color: '#123456' });
  });

  it('throws outside ThemeProvider', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Text>Orphan</Text>)).rejects.toThrow(
      'useTheme must be used inside <ThemeProvider>',
    );
    consoleError.mockRestore();
  });
});
