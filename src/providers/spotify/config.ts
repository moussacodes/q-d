/**
 * Spotify endpoints and the scopes q’d asks for. q’d is a remote control for
 * the Spotify app (docs/PROVIDER_FEASIBILITY.md): it never streams, relays or
 * rebroadcasts Spotify audio, so it asks only for what controlling playback
 * needs. Each scope is justified in docs/DECISIONS.md (2026-11-25 · Spotify
 * connection).
 */

export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
export const SPOTIFY_AUTHORIZE_URL = `${SPOTIFY_ACCOUNTS_URL}/authorize`;
export const SPOTIFY_TOKEN_URL = `${SPOTIFY_ACCOUNTS_URL}/api/token`;
export const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

export const SPOTIFY_SCOPES = [
  // Read the player and the list of devices: what's playing, where, and
  // whether a Spotify app is open to control.
  'user-read-playback-state',
  // Play a track, pause, resume, seek, add to the queue, move playback to
  // this phone's Spotify app.
  'user-modify-playback-state',
  // Read the currently playing track for the Now playing screen.
  'user-read-currently-playing',
] as const;

/** Path of the redirect back into q’d, e.g. `qd://spotify-auth`. */
export const SPOTIFY_REDIRECT_PATH = 'spotify-auth';

/** The response shape every injected `fetch` must provide (a subset of `Response`). */
export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type HttpRequest = {
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
};

/** A subset of `fetch`, injected so every request can be tested. */
export type FetchLike = (url: string, init: HttpRequest) => Promise<HttpResponse>;

/** `application/x-www-form-urlencoded` or a query string, written out by hand. */
export function encodeForm(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/** The body as text, or '' if it can't be read. */
export async function readText(response: HttpResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Parses JSON, or returns undefined if `text` is empty or not JSON. */
export function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parses a JSON body, or returns undefined if it's empty or not JSON. */
export async function readJson(response: HttpResponse): Promise<unknown> {
  return parseJson(await readText(response));
}
