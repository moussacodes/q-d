import type { NowPlayingPalette } from './nowPlaying';

/**
 * Dynamic color modes (Figma `20 · Mobile`, "Now playing" variable modes).
 *
 * Provider rules (plan.md §3, UI implementation source):
 * - Apple Music supplies a background color with its artwork, and q’d may use
 *   it. `paletteFromArtworkColor` turns that one color into a full palette.
 * - Spotify supplies no palette q’d is allowed to use, so Spotify songs get
 *   `neutralPlayingPalette`.
 * - Nothing here looks at artwork pixels. Covers are never analyzed, cropped
 *   or overlaid to pick colors.
 *
 * The lightness and saturation steps come from the Figma "Son of Spergy" mode
 * (accent #ff6b75, glows #eb2a37 / #8c3a35 / #eb9588), so a cover color with
 * that hue reproduces the mode. The other Figma modes take their second and
 * third glows from other colors in the artwork, which Apple doesn't supply;
 * here they follow the main hue.
 */

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl | null {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** h in degrees, s and l in percent. */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[channel(0), channel(8), channel(4)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `accent-soft` is the accent at 0x29 (16%) alpha, as in the Figma variables. */
const soft = (accent: string) => `${accent}29`;

/** Below this saturation a cover reads as grey, so the palette is grey too (Figma "Rebel"). */
const GREY_SATURATION = 0.12;

/**
 * The palette for songs whose provider supplies no usable color: warm greys
 * that don't come from the artwork or any provider's brand.
 */
export const neutralPlayingPalette: NowPlayingPalette = {
  accent: '#f3ede4',
  onAccent: '#0d0c0b',
  accentSoft: soft('#f3ede4'),
  glow1: '#8a7e70',
  glow2: '#453e37',
  glow3: '#c2b6a8',
};

const cache = new Map<string, NowPlayingPalette>();

/**
 * A full palette from one provider-supplied artwork color. The same color
 * always returns the same object, so screens can compare palettes cheaply.
 * Invalid colors fall back to `neutralPlayingPalette`.
 */
export function paletteFromArtworkColor(color: string): NowPlayingPalette {
  const key = color.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const hsl = hexToHsl(key);
  let palette: NowPlayingPalette;
  if (!hsl) {
    palette = neutralPlayingPalette;
  } else if (hsl.s < GREY_SATURATION) {
    const accent = hslToHex(0, 0, 93);
    palette = {
      accent,
      onAccent: hslToHex(0, 0, 5),
      accentSoft: soft(accent),
      glow1: hslToHex(0, 0, 55),
      glow2: hslToHex(0, 0, 29),
      glow3: hslToHex(0, 0, 78),
    };
  } else {
    // Whole degrees, so near-identical covers share one palette.
    const h = Math.round(hsl.h) % 360;
    const accent = hslToHex(h, 100, 71);
    palette = {
      accent,
      onAccent: hslToHex(h, 65, 7),
      accentSoft: soft(accent),
      glow1: hslToHex(h, 83, 54),
      glow2: hslToHex((h + 8) % 360, 45, 38),
      glow3: hslToHex((h + 12) % 360, 72, 73),
    };
  }
  cache.set(key, palette);
  return palette;
}
