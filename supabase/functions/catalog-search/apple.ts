/**
 * The Apple Music API side of canonical catalog search: the developer token,
 * the search request and turning Apple's song JSON into q’d's provider-track
 * shape (docs/API_CONTRACTS.md §6 `ProviderTrack`).
 *
 * Pure apart from `crypto.subtle`, which both Deno and Node provide, so Jest
 * runs it with recorded, synthetic fixtures. Built from Apple's documented
 * response shape; not yet tested against the live API (no developer key).
 */
import { normalizeIsrc, parseTitle } from '../../../src/domain/matching/text.ts';

export const APPLE_MUSIC_API = 'https://api.music.apple.com';

/** Apple returns at most 25 songs per search page. */
export const MAX_LIMIT = 25;
export const DEFAULT_LIMIT = 20;
/** Longer queries don't find anything a person would type. */
export const MAX_QUERY_LENGTH = 100;
export const DEFAULT_STOREFRONT = 'us';

// Apple's JSON ----------------------------------------------------------------

/** The parts of an Apple Music catalog song q’d reads. Everything is optional: never trust the shape. */
export type AppleSong = {
  id?: unknown;
  type?: unknown;
  attributes?: {
    name?: unknown;
    artistName?: unknown;
    albumName?: unknown;
    durationInMillis?: unknown;
    isrc?: unknown;
    contentRating?: unknown;
    artwork?: { url?: unknown; bgColor?: unknown } | null;
  } | null;
};

/** One normalized Apple song, in the domain's `ProviderTrack` shape plus its version tags. */
export type CatalogTrack = {
  provider: 'apple_music';
  providerTrackId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  isrc: string | null;
  explicit: boolean;
  /** Apple's URL template with `{w}`/`{h}` left in; the app sizes it. Never bundled. */
  artworkUrl: string | null;
  /** `#RRGGBB`. Apple lets q’d use it for the Now playing palette. */
  artworkBackgroundColor: string | null;
  /** Version markers read from the title (`live`, `remix`, …), for the canonical recording. */
  versionTags: string[];
};

const text = (value: unknown, max = 300): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

/** Apple song ids are digits. Anything else isn't a catalog song q’d can play. */
const SONG_ID = /^\d{1,30}$/;

const HTTPS = /^https:\/\/[^\s]+$/;

/**
 * One Apple song as a `CatalogTrack`, or `null` when it's missing what a
 * canonical recording needs (an id, a title, an artist and a positive
 * duration). Skipping is safer than inventing data.
 */
export function normalizeAppleSong(song: AppleSong): CatalogTrack | null {
  if (!song || typeof song !== 'object') return null;
  if (song.type !== undefined && song.type !== 'songs') return null;
  const id = typeof song.id === 'string' && SONG_ID.test(song.id) ? song.id : null;
  const attributes = song.attributes;
  if (!id || !attributes || typeof attributes !== 'object') return null;

  const title = text(attributes.name);
  const artist = text(attributes.artistName);
  const duration = attributes.durationInMillis;
  if (!title || !artist) return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 1) return null;

  const artworkUrl = text(attributes.artwork?.url, 2000);
  const bgColor = attributes.artwork?.bgColor;
  // Apple's artist credit is one string ("Delerium & Sarah McLachlan"). It's
  // kept whole: splitting at "&" would break "Simon & Garfunkel", and matching
  // splits credits itself.
  const artists = [artist];
  const markers = parseTitle(title, artists).markers.filter(
    // "Clean" is the explicit flag's business, not a version (DECISIONS.md, Track matching).
    (marker) => marker !== 'clean',
  );

  return {
    provider: 'apple_music',
    providerTrackId: id,
    title,
    artists,
    album: text(attributes.albumName),
    durationMs: Math.round(duration),
    isrc: normalizeIsrc(typeof attributes.isrc === 'string' ? attributes.isrc : null),
    explicit: attributes.contentRating === 'explicit',
    artworkUrl: artworkUrl && HTTPS.test(artworkUrl) ? artworkUrl : null,
    artworkBackgroundColor:
      typeof bgColor === 'string' && /^[0-9a-f]{6}$/i.test(bgColor)
        ? `#${bgColor.toUpperCase()}`
        : null,
    versionTags: markers,
  };
}

/**
 * Songs from a search response, in Apple's order. Unusable songs and repeats
 * of the same id are dropped; `skipped` counts them (for metrics, not for
 * users). An empty search has no `songs` key at all, which is zero results.
 */
export function normalizeSearchResponse(body: unknown): {
  tracks: CatalogTrack[];
  skipped: number;
} {
  const songs = (body as { results?: { songs?: { data?: unknown } } } | null)?.results?.songs?.data;
  if (!Array.isArray(songs)) return { tracks: [], skipped: 0 };
  const tracks: CatalogTrack[] = [];
  let skipped = 0;
  for (const song of songs) {
    const track = normalizeAppleSong(song as AppleSong);
    if (!track || tracks.some((t) => t.providerTrackId === track.providerTrackId)) {
      skipped += 1;
      continue;
    }
    tracks.push(track);
  }
  return { tracks, skipped };
}

/** Whether a response body looks like an Apple search answer at all. */
export function isSearchResponse(body: unknown): boolean {
  return !!body && typeof body === 'object' && 'results' in body;
}

export function searchUrl(storefront: string, query: string, limit: number): string {
  const params = new URLSearchParams({ term: query, types: 'songs', limit: String(limit) });
  return `${APPLE_MUSIC_API}/v1/catalog/${encodeURIComponent(storefront)}/search?${params}`;
}

// Developer token -----------------------------------------------------------

/**
 * Apple Music API developer token settings, from Edge Function secrets
 * (APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY). The
 * private key is the MusicKit `.p8` file's text. None of it ever ships in the
 * app or reaches a log.
 */
export type DeveloperKey = { teamId: string; keyId: string; privateKey: string };

/** Tokens are minted for 12 hours (Apple allows up to six months) and replaced an hour early. */
export const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const TOKEN_REFRESH_MARGIN_SECONDS = 60 * 60;

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error('APPLE_MUSIC_PRIVATE_KEY is not a PEM key');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A signed Apple Music developer token: an ES256 JWT with the key id in the
 * header and the team id as issuer. WebCrypto's ECDSA signature is already
 * the raw `r || s` form JWS expects.
 */
export async function mintDeveloperToken(
  key: DeveloperKey,
  nowSeconds: number,
  lifetimeSeconds = TOKEN_LIFETIME_SECONDS,
): Promise<string> {
  const header = encodeJson({ alg: 'ES256', kid: key.keyId, typ: 'JWT' });
  const payload = encodeJson({
    iss: key.teamId,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
  });
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(key.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/** Keeps one token per function instance and mints a new one before it expires. */
export function createTokenCache(key: DeveloperKey, nowSeconds: () => number) {
  let cached: { token: string; expiresAt: number } | null = null;
  return {
    async get(): Promise<string> {
      const now = nowSeconds();
      if (!cached || cached.expiresAt - TOKEN_REFRESH_MARGIN_SECONDS <= now) {
        cached = {
          token: await mintDeveloperToken(key, now),
          expiresAt: now + TOKEN_LIFETIME_SECONDS,
        };
      }
      return cached.token;
    },
    /** Forget the token, for example after Apple rejects it. */
    clear() {
      cached = null;
    },
  };
}
