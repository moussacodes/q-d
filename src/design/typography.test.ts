import { typography } from './typography';

describe('typography', () => {
  it('converts Figma letter spacing (a % of font size) to points', () => {
    // −3% at 36 pt is −1.08 pt (docs/DECISIONS.md).
    expect(typography.hero.letterSpacing).toBeCloseTo(-1.08);
    // +6% at 11 pt.
    expect(typography.eyebrow.letterSpacing).toBeCloseTo(0.66);
  });

  it('leaves letter spacing unset when Figma has none', () => {
    expect(typography.body).not.toHaveProperty('letterSpacing');
  });

  it('leaves line height unset for the logo', () => {
    expect(typography.logo).not.toHaveProperty('lineHeight');
  });
});
