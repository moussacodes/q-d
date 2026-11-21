/**
 * "Now playing" colors. In Figma these are variable modes, one per sample
 * cover; in the app they are computed from the playing song's artwork.
 * With nothing playing (sign-in, onboarding, idle Home) the palette is `idle`:
 * no glow and warm-white highlights.
 */
export type NowPlayingPalette = {
  /** Buttons, progress and highlights: the cover's most vivid color. */
  accent: string;
  /** Text and icons drawn on top of `accent`. */
  onAccent: string;
  /** Soft accent fill, e.g. accent chips. */
  accentSoft: string;
  /** Backdrop glows (top-left, bottom-right, top-right). */
  glow1: string;
  glow2: string;
  glow3: string;
};

const transparent = '#00000000';

/** `accent-soft` is the accent at 0x29 (16%) alpha, as in the Figma variables. */
const soft = (accent: string) => `${accent}29`;

export const idlePalette: NowPlayingPalette = {
  accent: '#f3ede4',
  onAccent: '#0d0c0b',
  accentSoft: soft('#f3ede4'),
  glow1: transparent,
  glow2: transparent,
  glow3: transparent,
};

/**
 * The Figma preview modes. They are sample data for mocks and the component
 * gallery, not product colors.
 */
export const previewPalettes = {
  idle: idlePalette,
  sonOfSpergy: {
    accent: '#ff6b75',
    onAccent: '#1c0607',
    accentSoft: soft('#ff6b75'),
    glow1: '#eb2a37',
    glow2: '#8c3a35',
    glow3: '#eb9588',
  },
  frenchExit: {
    accent: '#ff6bba',
    onAccent: '#1c0612',
    accentSoft: soft('#ff6bba'),
    glow1: '#eb2a91',
    glow2: '#1f56cc',
    glow3: '#ff94c9',
  },
  neverEnough: {
    accent: '#6b84ff',
    onAccent: '#06091c',
    accentSoft: soft('#6b84ff'),
    glow1: '#2a4aeb',
    glow2: '#30189e',
    glow3: '#5eb2eb',
  },
  rebel: {
    accent: '#ededed',
    onAccent: '#0d0d0d',
    accentSoft: soft('#ededed'),
    glow1: '#8c8c8c',
    glow2: '#4a4a4a',
    glow3: '#c8c8c8',
  },
} satisfies Record<string, NowPlayingPalette>;

export type PreviewPaletteName = keyof typeof previewPalettes;

export const previewPaletteLabels: Record<PreviewPaletteName, string> = {
  idle: 'Idle',
  sonOfSpergy: 'Son of Spergy',
  frenchExit: 'French Exit',
  neverEnough: 'Never Enough',
  rebel: 'Rebel',
};
