// COPY of src/domain/matching/text.ts for the Edge Functions. Don't edit here:
// change src/domain/matching/text.ts and copy it below this banner. Supabase
// deploys only what's under supabase/functions, so a function can't import
// src/ directly. supabase/tests/functions/shared-matching-text.test.ts fails
// if the two drift apart.

/**
 * Text rules for matching (docs/PRODUCT_SPEC.md §6, rule 2): normalize case,
 * punctuation, accents, `&`/`and` and featured-artist formatting, and read the
 * version markers (live, remix, …) out of a title. Pure and deterministic.
 */

/** Letters that Unicode decomposition doesn't reduce to ASCII. */
const FOLDS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Lowercase, without accents, with `&` and `+` as "and" and apostrophes dropped. Keeps punctuation. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => FOLDS[letter] ?? letter)
    .replace(/['’‘`´]/g, '')
    .replace(/\s*[&+]\s*/g, ' and ');
}

/**
 * Comparable text: lowercase, no accents, `&`/`+` read as "and", apostrophes
 * dropped and every other run of punctuation or space turned into one space.
 * Letters and digits of every script are kept, so non-Latin titles still compare.
 */
export function normalizeText(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Splits one artist credit at commas, "and", "feat." and the like. */
const ARTIST_SEPARATORS = /\s*,\s*|\s*;\s*|\s+and\s+|\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/;

/**
 * Every artist named in the credits, normalized, in order, without repeats.
 * `['Delerium & Sarah McLachlan']` and `['Delerium', 'Sarah McLachlan']` give
 * the same list, so the first entry is a reliable primary artist.
 */
export function splitArtists(credits: readonly string[]): string[] {
  const names: string[] = [];
  for (const credit of credits) {
    for (const part of fold(credit).split(ARTIST_SEPARATORS)) {
      const name = normalizeText(part);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Version markers q’d tells apart (PRODUCT_SPEC.md §6, rule 4). Each is a
 * different recording from the plain one unless an exact ISRC says otherwise.
 * They're only read from a title's brackets or its " - " suffix, so a song
 * called "Live Forever" isn't a live version.
 */
export const versionMarkers = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'sped_up',
  'slowed',
  'clean',
  'remastered',
  'radio_edit',
  'extended',
  'demo',
  'karaoke',
  'a_cappella',
] as const;
export type VersionMarker = (typeof versionMarkers)[number];

const MARKER_PATTERNS: [VersionMarker, RegExp][] = [
  ['live', /\blive\b|\bin concert\b/],
  ['remix', /\bre ?mix(ed)?\b|\brmx\b|\b(club|dub|vip) mix\b/],
  ['acoustic', /\bacoustic\b|\bunplugged\b/],
  ['instrumental', /\binstrumental\b/],
  ['sped_up', /\bsped up\b|\bspeed up\b|\bnightcore\b/],
  ['slowed', /\bslowed\b/],
  ['clean', /\bclean\b|\bedited version\b/],
  ['remastered', /\bremaster(ed)?\b/],
  ['radio_edit', /\bradio (edit|version|mix)\b/],
  ['extended', /\bextended\b/],
  ['demo', /\bdemo\b/],
  ['karaoke', /\bkaraoke\b/],
  ['a_cappella', /\ba ?capp?ella\b/],
];

/** Version markers named in one bracket or suffix. */
export function markersIn(segment: string): VersionMarker[] {
  const text = normalizeText(segment);
  return MARKER_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([marker]) => marker);
}

const FEATURING = /^(?:feat\.?|ft\.?|featuring)\s+(.+)$/;
const WITH = /^with\s+(.+)$/;

export type ParsedTitle = {
  /** The title without version markers or featured artists, normalized. */
  core: string;
  /** Version markers found in the title, sorted. */
  markers: VersionMarker[];
  /** Artists credited in the title ("feat. X"), normalized. */
  featured: string[];
};

/**
 * Reads a title: "Rain Down (feat. Sarah McLachlan) [2011 Remaster]" has the
 * core "rain down", the marker `remastered` and the featured artist
 * "sarah mclachlan". A "(with X)" bracket only counts as a credit when X is one
 * of `artists`, so "Have a Baby (With Me)" keeps its full title.
 */
export function parseTitle(title: string, artists: readonly string[] = []): ParsedTitle {
  const known = splitArtists(artists);
  const markers = new Set<VersionMarker>();
  const featured: string[] = [];
  const kept: string[] = [];

  // Bracketed parts, then " - " suffixes, are the places markers and credits live.
  const brackets: string[] = [];
  let rest = fold(title).replace(/\s*[([{]([^)\]}]*)[)\]}]/g, (_match, inner: string) => {
    brackets.push(inner);
    return ' ';
  });
  const [head, ...suffixes] = rest.split(/\s+[-–—]\s+/);
  rest = head;

  const readSegment = (segment: string, keepIfPlain: boolean) => {
    const trimmed = segment.trim();
    const credit = FEATURING.exec(trimmed) ?? WITH.exec(trimmed);
    if (credit) {
      const names = splitArtists([credit[1]]);
      const isCredit =
        FEATURING.test(trimmed) ||
        (names.length > 0 && names.every((name) => known.includes(name)));
      if (isCredit) {
        names.forEach((name) => featured.includes(name) || featured.push(name));
        return;
      }
    }
    const found = markersIn(trimmed);
    if (found.length > 0) {
      found.forEach((marker) => markers.add(marker));
      return;
    }
    if (keepIfPlain) kept.push(trimmed);
  };

  // An unbracketed "feat. X" at the end of the head is a credit too.
  const inlineFeat = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/.exec(rest);
  if (inlineFeat) {
    splitArtists([inlineFeat[1]]).forEach((name) => featured.includes(name) || featured.push(name));
    rest = rest.slice(0, inlineFeat.index);
  }

  brackets.forEach((segment) => readSegment(segment, true));
  suffixes.forEach((segment) => readSegment(segment, true));

  return {
    core: normalizeText([rest, ...kept].join(' ')),
    markers: [...markers].sort(),
    featured,
  };
}

/** Compact uppercase ISRC (`US-RC1-76-07839` → `USRC17607839`), or `null` if it isn't one. */
export function normalizeIsrc(isrc: string | null | undefined): string | null {
  if (!isrc) return null;
  const compact = isrc.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(compact) ? compact : null;
}

/**
 * How alike two normalized strings are, from 0 to 1: the Sørensen–Dice
 * coefficient over character pairs, ignoring spaces. Equal strings give 1.
 */
export function similarity(a: string, b: string): number {
  const left = a.replace(/\s+/g, '');
  const right = b.replace(/\s+/g, '');
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < left.length - 1; i += 1) {
    const pair = left.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < right.length - 1; i += 1) {
    const pair = right.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * shared) / (left.length - 1 + right.length - 1);
}
