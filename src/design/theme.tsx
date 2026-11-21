import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { neutral } from './colors';
import { idlePalette, type NowPlayingPalette } from './nowPlaying';

export type ThemeColors = typeof neutral & NowPlayingPalette;

type ThemeContextValue = {
  colors: ThemeColors;
  palette: NowPlayingPalette;
  setPalette: (palette: NowPlayingPalette) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provides the current "Now playing" palette. Screens switch it when a song
 * starts or stops; everything that uses `useTheme()` re-colors with it.
 */
export function ThemeProvider({
  children,
  initialPalette = idlePalette,
}: {
  children: ReactNode;
  initialPalette?: NowPlayingPalette;
}) {
  const [palette, setPalette] = useState(initialPalette);
  const value = useMemo(
    () => ({ colors: { ...neutral, ...palette }, palette, setPalette }),
    [palette],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return value;
}
