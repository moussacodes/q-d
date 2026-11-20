import { SCREEN_PADDING, SCREEN_TOP_PADDING } from '@/components';

/** The expanded cover never gets smaller than this. On a very short screen the page scrolls. */
export const MIN_EXPANDED_COVER = 120;
/** Space between the playback controls and the Up next bar. */
export const SPACE_ABOVE_FOOTER = 8;
/** Space between the cover and the song title. */
export const EXPANDED_COVER_GAP = 16;
/** Space between the song info, timeline and controls: tighter than the default layout. */
export const EXPANDED_DECK_GAP = 12;

/**
 * 3.2 Room (expanded). The cover grows as big as it can while the song info,
 * timeline and playback controls still fit above the Up next bar, so nobody
 * scrolls to reach Play. The full queue starts below that first page.
 *
 * `viewport` is the height of the scroll area. `below` is the height of
 * everything under the cover. Until both are measured, the cover fills the width.
 */
export function expandedLayout({
  width,
  viewport,
  below,
}: {
  width: number;
  viewport: number;
  below: number;
}) {
  const widest = width - SCREEN_PADDING * 2;
  const page = Math.max(viewport - SCREEN_TOP_PADDING - SPACE_ABOVE_FOOTER, 0);
  if (!viewport || !below) return { cover: widest, page };
  const fits = page - EXPANDED_COVER_GAP - below;
  const cover = Math.max(Math.min(widest, fits), Math.min(widest, MIN_EXPANDED_COVER));
  return { cover: Math.floor(cover), page };
}
