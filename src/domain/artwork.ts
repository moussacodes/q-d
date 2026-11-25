/**
 * Provider artwork URLs. Apple's catalog gives artwork as a URL template with
 * `{w}` and `{h}` (and sometimes `{f}`, the file format) for the size, so the
 * app asks for exactly the pixels a cover needs. Artwork is always fetched from
 * the provider at runtime and never bundled (AGENTS.md → Assets).
 */

/** Largest edge Apple serves for catalog artwork. */
export const MAX_ARTWORK_PX = 3000;

/** True when the URL still has size placeholders to fill. */
export function isArtworkTemplate(url: string): boolean {
  return /\{[whf]\}/.test(url);
}

/**
 * The artwork URL for a square cover of `sizePx` pixels. A plain URL (Spotify,
 * or one already sized) comes back unchanged. `null` stays `null`, so the cover
 * shows its neutral placeholder.
 */
export function sizedArtworkUrl(url: string | null, sizePx: number): string | null {
  if (url === null || url === '') return null;
  const size = Math.min(
    MAX_ARTWORK_PX,
    Math.max(1, Math.round(Number.isFinite(sizePx) ? sizePx : 1)),
  );
  return url
    .replace(/\{w\}/g, String(size))
    .replace(/\{h\}/g, String(size))
    .replace(/\{f\}/g, 'jpg');
}
