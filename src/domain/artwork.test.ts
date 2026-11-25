import { isArtworkTemplate, MAX_ARTWORK_PX, sizedArtworkUrl } from './artwork';

const template = 'https://artwork.example.test/image/thumb/Synthetic/{w}x{h}bb.{f}';

describe('sizedArtworkUrl', () => {
  it('fills the width, height and format placeholders', () => {
    expect(sizedArtworkUrl(template, 300)).toBe(
      'https://artwork.example.test/image/thumb/Synthetic/300x300bb.jpg',
    );
  });

  it('rounds fractional sizes (device pixels)', () => {
    expect(sizedArtworkUrl(template, 171.6)).toContain('/172x172bb.');
  });

  it('clamps to 1…MAX_ARTWORK_PX', () => {
    expect(sizedArtworkUrl(template, 0)).toContain('/1x1bb.');
    expect(sizedArtworkUrl(template, -20)).toContain('/1x1bb.');
    expect(sizedArtworkUrl(template, Number.NaN)).toContain('/1x1bb.');
    expect(sizedArtworkUrl(template, 99999)).toContain(`/${MAX_ARTWORK_PX}x${MAX_ARTWORK_PX}bb.`);
  });

  it('leaves a plain URL unchanged', () => {
    const plain = 'https://images.example.test/cover.jpg';
    expect(sizedArtworkUrl(plain, 300)).toBe(plain);
  });

  it('keeps no artwork as no artwork', () => {
    expect(sizedArtworkUrl(null, 300)).toBeNull();
    expect(sizedArtworkUrl('', 300)).toBeNull();
  });
});

describe('isArtworkTemplate', () => {
  it('tells a template from a sized URL', () => {
    expect(isArtworkTemplate(template)).toBe(true);
    expect(isArtworkTemplate('https://images.example.test/cover.jpg')).toBe(false);
  });
});
