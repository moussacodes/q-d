import { neutralPlayingPalette, paletteFromArtworkColor } from './artworkPalette';
import { previewPalettes } from './nowPlaying';

/** Distance between two #rrggbb colors, per channel (0–255). */
function channelDistance(a: string, b: string) {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - y[i])));
}

describe('paletteFromArtworkColor', () => {
  it('reproduces the Figma "Son of Spergy" mode from a cover color with its hue', () => {
    const palette = paletteFromArtworkColor('#c41e2a');
    const figma = previewPalettes.sonOfSpergy;
    expect(palette.accent).toBe(figma.accent);
    for (const key of ['onAccent', 'glow1', 'glow2', 'glow3'] as const) {
      expect(channelDistance(palette[key], figma[key])).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the cover hue for the accent and first glow', () => {
    const blue = paletteFromArtworkColor('#1f3ac4');
    expect(channelDistance(blue.accent, previewPalettes.neverEnough.accent)).toBeLessThanOrEqual(3);
    expect(channelDistance(blue.glow1, previewPalettes.neverEnough.glow1)).toBeLessThanOrEqual(3);
  });

  it('turns grey covers into a grey palette, like the Figma "Rebel" mode', () => {
    const grey = paletteFromArtworkColor('#5a5a5a');
    expect(grey.accent).toBe(previewPalettes.rebel.accent);
    expect(grey.glow1).toBe(previewPalettes.rebel.glow1);
  });

  it('follows the accent-soft rule', () => {
    const palette = paletteFromArtworkColor('#c2186f');
    expect(palette.accentSoft).toBe(`${palette.accent}29`);
  });

  it('returns the same object for the same color, ignoring case', () => {
    expect(paletteFromArtworkColor('#C41E2A')).toBe(paletteFromArtworkColor('#c41e2a'));
  });

  it('falls back to the neutral palette for invalid colors', () => {
    expect(paletteFromArtworkColor('not a color')).toBe(neutralPlayingPalette);
  });
});
