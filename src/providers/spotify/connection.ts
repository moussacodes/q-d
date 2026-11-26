import { isProviderError } from '../errors';
import type { ConnectionState } from '../types';
import type { SpotifyApi } from './api';
import type { SpotifyAuth } from './auth';

/**
 * Whether this phone can use a Spotify account, as a `ConnectionState`. A
 * real Spotify connection is never a mock, so `isMock` is always false.
 */

const notMock = { isMock: false } as const;

/**
 * Checks stored tokens with Spotify by reading the player (the
 * `user-read-playback-state` scope). A development-mode app answers a user
 * who isn't on its user list with a 403, so this is where that shows up.
 *
 * Premium isn't checked here: reading the player works without it. Spotify
 * refuses the first play command instead (`premium_required`), which the
 * playback adapter reports.
 */
async function verify(auth: SpotifyAuth, api: SpotifyApi): Promise<ConnectionState> {
  try {
    await api.request({ method: 'GET', path: '/me/player' });
    return { status: 'connected', ...notMock };
  } catch (error) {
    const code = isProviderError(error) ? error.code : 'provider_unavailable';
    switch (code) {
      case 'needs_authorization':
        return { status: 'needs_authorization', ...notMock };
      case 'premium_required':
        return { status: 'needs_subscription', ...notMock };
      // Reading the player with no Spotify app open isn't a connection problem.
      case 'no_active_device':
        return { status: 'connected', ...notMock };
      case 'not_approved_user':
        // The tokens can't do anything; forget them so nothing looks connected.
        await auth.disconnect().catch(() => {});
        return { status: 'error', code, ...notMock };
      default:
        // Offline, rate limited or Spotify failing: keep the tokens, try later.
        return { status: 'error', code, ...notMock };
    }
  }
}

/**
 * The connection from stored tokens, without opening any sign-in sheet.
 *
 * `needs_authorization` means the tokens really are gone (never stored, or
 * Spotify refused them and they were forgotten). A Keychain that can't be
 * read right now (before the first unlock, or failing mid-check) is
 * `provider_unavailable` instead: startup reconcile deletes the account's
 * `provider_connections` row on `needs_authorization`, and a false delete
 * would stop this phone hosting.
 */
export async function spotifyConnectionStatus(
  auth: SpotifyAuth,
  api: SpotifyApi,
): Promise<ConnectionState> {
  if (!auth.configured) return { status: 'error', code: 'not_configured', ...notMock };
  const unreadable = { status: 'error', code: 'provider_unavailable', ...notMock } as const;
  const stored = await auth.storedCredentials();
  if (stored === 'unreadable') return unreadable;
  if (stored === 'none') return { status: 'needs_authorization', ...notMock };
  const state = await verify(auth, api);
  if (state.status !== 'needs_authorization') return state;
  // Spotify's refusals forget the tokens. Tokens still here (or a store that
  // can't be read) mean the check failed reading them, not that they're gone.
  return (await auth.storedCredentials()) === 'none' ? state : unreadable;
}

/** "Connect Spotify": runs the sign-in sheet, stores the tokens and checks them. */
export async function connectSpotify(auth: SpotifyAuth, api: SpotifyApi): Promise<ConnectionState> {
  const result = await auth.authorize();
  switch (result.type) {
    case 'cancelled':
      return { status: 'needs_authorization', ...notMock };
    case 'failed':
      return { status: 'error', code: result.code, ...notMock };
    case 'authorized':
      return verify(auth, api);
  }
}

/** "Disconnect Spotify": forgets the tokens on this phone. */
export async function disconnectSpotify(auth: SpotifyAuth): Promise<void> {
  await auth.disconnect();
}
