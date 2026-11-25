import { log } from '@/services/logger';

import { ProviderError } from '../errors';
import type { ProviderErrorCode } from '../types';
import {
  encodeForm,
  parseJson,
  readText,
  SPOTIFY_API_URL,
  type FetchLike,
  type HttpResponse,
} from './config';
import type { SpotifyAuth } from './auth';

/**
 * A small Spotify Web API client: adds the access token, refreshes it once
 * on a 401, and turns Spotify's errors into `ProviderError` codes. Built,
 * untested against real Spotify.
 */

export type ApiRequest = {
  method: 'GET' | 'PUT' | 'POST';
  /** e.g. `/me/player`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export type ApiResponse = {
  status: number;
  /** Parsed JSON, or undefined for an empty body (204). */
  data: unknown;
};

export interface SpotifyApi {
  request(request: ApiRequest): Promise<ApiResponse>;
}

export type SpotifyApiDeps = {
  auth: SpotifyAuth;
  fetch: FetchLike;
  /** Waits between retries. Defaults to `setTimeout`, so tests use fake timers. */
  sleep?: (ms: number) => Promise<void>;
  /** How many times a 429 is retried after waiting. */
  maxRateLimitRetries?: number;
  /** A `Retry-After` longer than this isn't waited for: the call fails with `rate_limited`. */
  maxRetryAfterMs?: number;
};

/** Default waits. */
export const RATE_LIMIT_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 10_000;
/** Used when a 429 has no readable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 1_000;
/** Backoff before retrying a 5xx: 500 ms, then 1 s. */
export const SERVER_ERROR_BACKOFF_MS = [500, 1_000] as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` in milliseconds. Spotify sends whole seconds. */
export function retryAfterMs(header: string | null): number {
  if (header === null || !/^\s*\d+(\.\d+)?\s*$/.test(header)) return DEFAULT_RETRY_AFTER_MS;
  return Math.ceil(Number(header) * 1000);
}

const apiLog = log.child('spotify.api');

/** Spotify's error body: `{ error: { status, message, reason? } }`. */
type SpotifyErrorBody = { message?: string; reason?: string };

function errorBody(data: unknown): SpotifyErrorBody {
  // Some errors come back as plain text, e.g. the development-mode refusal.
  if (typeof data === 'string') return { message: data.slice(0, 300) };
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error: unknown }).error;
    if (error && typeof error === 'object') {
      const { message, reason } = error as Record<string, unknown>;
      return {
        message: typeof message === 'string' ? message : undefined,
        reason: typeof reason === 'string' ? reason : undefined,
      };
    }
  }
  return {};
}

/**
 * Spotify development mode answers a user who isn't on the app's user list
 * with a 403 whose message mentions the developer dashboard. The exact text
 * isn't documented, so this matches loosely. Verify on device.
 */
const NOT_APPROVED =
  /not (been |be )?registered|developer\.spotify\.com\/dashboard|developer dashboard|not approved|allowlist/i;

/** Maps a failed response to a code. Exported for tests. */
export function errorCodeFor(status: number, data: unknown, path: string): ProviderErrorCode {
  const { message = '', reason } = errorBody(data);
  if (status === 401) return 'needs_authorization';
  if (status === 403) {
    if (reason === 'PREMIUM_REQUIRED' || /premium required/i.test(message)) {
      return 'premium_required';
    }
    if (reason === 'NO_ACTIVE_DEVICE') return 'no_active_device';
    if (NOT_APPROVED.test(message)) return 'not_approved_user';
    return 'playback_refused';
  }
  if (status === 404) {
    if (reason === 'NO_ACTIVE_DEVICE' || /no active device/i.test(message)) {
      return 'no_active_device';
    }
    // The player endpoints answer 404 when there's no device to control.
    return path.startsWith('/me/player') ? 'no_active_device' : 'not_found';
  }
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_argument';
  return 'provider_unavailable';
}

/** A `ProviderError` that also carries Spotify's player reason, when there was one. */
export class SpotifyApiError extends ProviderError {
  constructor(
    code: ProviderErrorCode,
    readonly status: number,
    readonly reason: string | undefined,
  ) {
    super(code, 'spotify', `Spotify answered ${status}`);
  }
}

/** Spotify's player `reason` for a failed request, e.g. `ALREADY_PAUSED`. */
export function spotifyReason(error: unknown): string | undefined {
  return error instanceof SpotifyApiError ? error.reason : undefined;
}

export function createSpotifyApi(deps: SpotifyApiDeps): SpotifyApi {
  const { auth, fetch } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const maxRateLimitRetries = deps.maxRateLimitRetries ?? RATE_LIMIT_RETRIES;
  const maxRetryAfter = deps.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;

  async function send(request: ApiRequest, token: string): Promise<HttpResponse> {
    const query = request.query ? encodeForm(request.query) : '';
    const url = `${SPOTIFY_API_URL}${request.path}${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    try {
      return await fetch(url, { method: request.method, headers, body });
    } catch {
      throw new ProviderError('provider_unavailable', 'spotify', 'Could not reach Spotify');
    }
  }

  return {
    async request(request) {
      let token = await auth.accessToken();
      let refreshed = false;
      let rateLimitRetries = 0;
      let serverRetries = 0;
      for (;;) {
        const response = await send(request, token);
        const text = await readText(response);
        if (response.status >= 200 && response.status < 300) {
          return { status: response.status, data: parseJson(text) };
        }
        const data = parseJson(text) ?? text;
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          token = await auth.refreshAfterRejection(token);
          continue;
        }
        if (response.status === 429 && rateLimitRetries < maxRateLimitRetries) {
          const wait = retryAfterMs(response.headers.get('Retry-After'));
          if (wait <= maxRetryAfter) {
            rateLimitRetries += 1;
            await sleep(wait);
            continue;
          }
        }
        // A 5xx is retried with backoff, except POST (adding to Spotify's
        // queue), which might have worked and would add the song twice.
        if (
          response.status >= 500 &&
          request.method !== 'POST' &&
          serverRetries < SERVER_ERROR_BACKOFF_MS.length
        ) {
          await sleep(SERVER_ERROR_BACKOFF_MS[serverRetries]);
          serverRetries += 1;
          continue;
        }
        if (response.status === 401) {
          // A fresh token was refused too: the grant is gone. Reconnect.
          apiLog.warn('Spotify refused a refreshed token');
          await auth.disconnect().catch(() => {});
        }
        const code = errorCodeFor(response.status, data, request.path);
        const { reason } = errorBody(data);
        // Expected answers the adapter handles itself aren't worth a warning.
        if (code !== 'no_active_device' && !reason?.startsWith('ALREADY_')) {
          apiLog.warn('Spotify request failed', {
            status: response.status,
            reason,
            method: request.method,
            endpoint: request.path,
          });
        }
        throw new SpotifyApiError(code, response.status, reason);
      }
    },
  };
}
