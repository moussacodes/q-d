import { providerNames, type MusicProvider } from '@/domain/music-provider';
import type { ConnectionState, ProviderErrorCode } from '@/providers';

/**
 * What to tell the person when a music service didn't connect or refused a
 * command. Honest and short: it says what's wrong and what they can do, and
 * never claims more than q’d does (q’d controls the Spotify app; it doesn't
 * play Spotify audio itself).
 */
export function providerErrorCopy(provider: MusicProvider, code: ProviderErrorCode): string {
  const name = providerNames[provider];
  switch (code) {
    case 'premium_required':
      return provider === 'spotify'
        ? 'Spotify Premium is needed to play rooms through Spotify.'
        : `An ${name} subscription is needed to play rooms.`;
    case 'not_approved_user':
      return `This ${name} account isn’t on q’d’s tester list yet. ${name} limits q’d to a few testers for now, so ask the team to add you.`;
    case 'no_active_device':
      return `Open ${name} on this phone, then try again.`;
    case 'needs_authorization':
      return `Connect ${name} again to keep playing.`;
    case 'not_configured':
    case 'not_in_this_build':
      return `${name} isn’t available in this build of q’d yet.`;
    case 'rate_limited':
      return `${name} is busy right now. Try again in a minute.`;
    case 'provider_unavailable':
      return `Couldn’t reach ${name}. Check your connection and try again.`;
    case 'playback_refused':
      return `${name} didn’t accept that. Check the ${name} app, then try again.`;
    case 'auth_failed':
    default:
      return `Couldn’t connect ${name}. Try again.`;
  }
}

/** Copy for a connection that isn't connected, or null when it is. */
export function connectionProblemCopy(
  provider: MusicProvider,
  state: ConnectionState,
): string | null {
  const name = providerNames[provider];
  switch (state.status) {
    case 'connected':
      return null;
    case 'needs_authorization':
      return `${name} isn’t connected yet. Tap Connect to try again.`;
    case 'needs_subscription':
      return providerErrorCopy(provider, 'premium_required');
    case 'app_not_installed':
      return `Install ${name} on this phone to play rooms through it.`;
    case 'error':
      return providerErrorCopy(provider, state.code);
  }
}
