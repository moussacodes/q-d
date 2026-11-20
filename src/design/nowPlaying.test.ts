import { idlePalette, previewPalettes } from './nowPlaying';

describe('now playing palettes', () => {
  it.each(Object.entries(previewPalettes))(
    '%s: accentSoft is the accent at 0x29 alpha',
    (_name, palette) => {
      expect(palette.accentSoft).toBe(`${palette.accent}29`);
    },
  );

  it('has no glow while nothing is playing', () => {
    expect([idlePalette.glow1, idlePalette.glow2, idlePalette.glow3]).toEqual([
      '#00000000',
      '#00000000',
      '#00000000',
    ]);
  });
});
