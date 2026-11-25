import type { MusicProvider } from '@/domain/music-provider';

/**
 * Reads Apple Music and Spotify share links. Only the link's shape is checked
 * here; whether the track or playlist exists is the catalog adapter's job.
 *
 * Apple Music:
 * - `https://music.apple.com/us/song/<slug>/<id>`
 * - `https://music.apple.com/us/album/<slug>/<albumId>?i=<id>` (a song on an album)
 * - `https://music.apple.com/us/playlist/<slug>/pl.<id>`
 *
 * Spotify:
 * - `https://open.spotify.com/track/<id>` (optionally `/intl-xx/track/<id>`)
 * - `https://open.spotify.com/playlist/<id>`
 * - `spotify:track:<id>` and `spotify:playlist:<id>`
 */
export type ProviderLink = {
  provider: MusicProvider;
  kind: 'track' | 'playlist';
  id: string;
};

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const APPLE_SONG_ID = /^\d+$/;
const APPLE_PLAYLIST_ID = /^pl\.[A-Za-z0-9-]+$/;

/**
 * Splits an https link by hand. React Native's `URL` doesn't implement
 * `hostname`, `pathname` or `searchParams` on every platform.
 */
function parseUrl(
  text: string,
): { host: string; parts: string[]; query: Map<string, string> } | null {
  const match = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(text);
  if (!match) return null;
  const [, host, path, search = ''] = match;
  const query = new Map<string, string>();
  for (const pair of search.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) query.set(key, value);
  }
  return { host: host.toLowerCase(), parts: path.split('/').filter(Boolean), query };
}

function spotifyLink(kind: string | undefined, id: string | undefined): ProviderLink | null {
  if ((kind !== 'track' && kind !== 'playlist') || !id || !SPOTIFY_ID.test(id)) return null;
  return { provider: 'spotify', kind, id };
}

/** The provider, kind and id a link points at, or `null` if q’d can't use it. */
export function parseProviderLink(text: string): ProviderLink | null {
  const trimmed = text.trim();

  if (trimmed.startsWith('spotify:')) {
    const [, kind, id, ...rest] = trimmed.split(':');
    return rest.length === 0 ? spotifyLink(kind, id) : null;
  }

  const url = parseUrl(trimmed);
  if (!url) return null;
  const { parts } = url;

  if (url.host === 'open.spotify.com') {
    const path = parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
    return path.length === 2 ? spotifyLink(path[0], path[1]) : null;
  }

  if (url.host === 'music.apple.com') {
    // /<storefront>/<kind>/<slug>/<id>; the slug is optional.
    const [, kind, ...rest] = parts;
    const id = rest.at(-1);
    if (kind === 'song' && id && APPLE_SONG_ID.test(id)) {
      return { provider: 'apple_music', kind: 'track', id };
    }
    if (kind === 'album') {
      const song = url.query.get('i');
      return song && APPLE_SONG_ID.test(song)
        ? { provider: 'apple_music', kind: 'track', id: song }
        : null;
    }
    if (kind === 'playlist' && id && APPLE_PLAYLIST_ID.test(id)) {
      return { provider: 'apple_music', kind: 'playlist', id };
    }
  }

  return null;
}
