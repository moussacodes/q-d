import type { ConnectionState, ProviderErrorCode } from '@/providers';

import { connectionProblemCopy, providerErrorCopy } from './connectionCopy';

const codes: ProviderErrorCode[] = [
  'not_in_this_build',
  'not_found',
  'unsupported_link',
  'wrong_provider',
  'invalid_argument',
  'not_configured',
  'needs_authorization',
  'auth_failed',
  'permission_denied',
  'premium_required',
  'not_approved_user',
  'no_active_device',
  'playback_refused',
  'rate_limited',
  'provider_unavailable',
];

describe('providerErrorCopy', () => {
  it('says Spotify Premium is needed', () => {
    expect(providerErrorCopy('spotify', 'premium_required')).toBe(
      'Spotify Premium is needed to play rooms through Spotify.',
    );
  });

  it('explains the development-mode tester list without blaming the person', () => {
    expect(providerErrorCopy('spotify', 'not_approved_user')).toBe(
      'This Spotify account isn’t on q’d’s tester list yet. Spotify limits q’d to a few testers for now, so ask the team to add you.',
    );
  });

  it('asks for the Spotify app to be open when there is no device', () => {
    expect(providerErrorCopy('spotify', 'no_active_device')).toBe(
      'Open Spotify on this phone, then try again.',
    );
  });

  it.each(codes)('has short, honest copy for %s on both services', (code) => {
    for (const provider of ['spotify', 'apple_music'] as const) {
      const copy = providerErrorCopy(provider, code);
      expect(copy.length).toBeGreaterThan(10);
      expect(copy.length).toBeLessThan(160);
      // Never suggests q’d streams the audio itself, or that it works for everyone.
      expect(copy).not.toMatch(/stream|in sync|YouTube|TIDAL|Deezer|Amazon/i);
      // Curly apostrophes, like the rest of the app.
      expect(copy).not.toContain("'");
    }
  });
});

describe('Apple Music copy', () => {
  it('says real Apple Music needs the q’d app build, never that it works', () => {
    expect(providerErrorCopy('apple_music', 'not_in_this_build')).toBe(
      'Apple Music needs the q’d app build. It can’t connect in Expo Go or on the web.',
    );
  });

  it('sends a refused permission to iOS Settings', () => {
    expect(providerErrorCopy('apple_music', 'permission_denied')).toBe(
      'q’d doesn’t have access to Apple Music. Turn it on in Settings › q’d, then try again.',
    );
  });

  it('asks for a subscription', () => {
    expect(
      connectionProblemCopy('apple_music', { status: 'needs_subscription', isMock: false }),
    ).toBe('An Apple Music subscription is needed to play rooms.');
  });
});

describe('connectionProblemCopy', () => {
  const states: [ConnectionState, string | null][] = [
    [{ status: 'connected', isMock: false }, null],
    [
      { status: 'needs_authorization', isMock: false },
      'Spotify isn’t connected yet. Tap Connect to try again.',
    ],
    [
      { status: 'needs_subscription', isMock: false },
      'Spotify Premium is needed to play rooms through Spotify.',
    ],
    [
      { status: 'app_not_installed', isMock: false },
      'Install Spotify on this phone to play rooms through it.',
    ],
    [
      { status: 'error', code: 'not_configured', isMock: false },
      'Spotify isn’t available in this build of q’d yet.',
    ],
    [
      { status: 'error', code: 'auth_failed', isMock: false },
      'Couldn’t connect Spotify. Try again.',
    ],
  ];
  it.each(states)('%j → %p', (state, copy) => {
    expect(connectionProblemCopy('spotify', state)).toBe(copy);
  });

  it('names Apple Music for Apple Music', () => {
    expect(
      connectionProblemCopy('apple_music', { status: 'needs_subscription', isMock: false }),
    ).toBe('An Apple Music subscription is needed to play rooms.');
  });
});
