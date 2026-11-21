import {
  EXPANDED_COVER_GAP,
  expandedLayout,
  MIN_EXPANDED_COVER,
  SPACE_ABOVE_FOOTER,
} from './expandedLayout';

describe('expandedLayout', () => {
  it('fills the width before the screen is measured', () => {
    expect(expandedLayout({ width: 393, viewport: 0, below: 0 }).cover).toBe(353);
  });

  it('shrinks the cover so the controls end above the Up next bar', () => {
    const { cover, page } = expandedLayout({ width: 393, viewport: 560, below: 220 });
    expect(cover).toBe(300);
    // Top padding + cover + gap + song info and controls = the first page.
    expect(16 + cover + EXPANDED_COVER_GAP + 220).toBe(560 - SPACE_ABOVE_FOOTER);
    expect(page).toBe(560 - 16 - SPACE_ABOVE_FOOTER);
  });

  it('stops at the width on a tall screen', () => {
    expect(expandedLayout({ width: 393, viewport: 900, below: 220 }).cover).toBe(353);
  });

  it('keeps a usable cover on a very short screen', () => {
    expect(expandedLayout({ width: 393, viewport: 300, below: 220 }).cover).toBe(
      MIN_EXPANDED_COVER,
    );
  });

  it('rounds down so the controls never land a fraction off the page', () => {
    expect(expandedLayout({ width: 393, viewport: 560.6, below: 220.2 }).cover).toBe(300);
  });
});
