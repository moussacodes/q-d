import { checkSwitch, planSong } from './provider-switch';

describe('planSong', () => {
  it('plays a song that’s on the room’s service', () => {
    expect(
      planSong({
        playsThrough: 'spotify',
        availableOn: ['apple_music', 'spotify'],
        hostConnected: ['spotify'],
      }),
    ).toEqual({ kind: 'play', provider: 'spotify' });
  });

  it('plays it without offering a switch, even with both services connected', () => {
    expect(
      planSong({
        playsThrough: 'apple_music',
        availableOn: ['apple_music', 'spotify'],
        hostConnected: ['spotify', 'apple_music'],
      }),
    ).toEqual({ kind: 'play', provider: 'apple_music' });
  });

  it('offers a switch when the song is on another service the host connected', () => {
    expect(
      planSong({
        playsThrough: 'spotify',
        availableOn: ['apple_music'],
        hostConnected: ['spotify', 'apple_music'],
      }),
    ).toEqual({ kind: 'offer_switch', from: 'spotify', to: 'apple_music' });
    expect(
      planSong({
        playsThrough: 'apple_music',
        availableOn: ['spotify'],
        hostConnected: ['apple_music', 'spotify'],
      }),
    ).toEqual({ kind: 'offer_switch', from: 'apple_music', to: 'spotify' });
  });

  it('only offers to skip when the host hasn’t connected the other service', () => {
    expect(
      planSong({
        playsThrough: 'spotify',
        availableOn: ['apple_music'],
        hostConnected: ['spotify'],
      }),
    ).toEqual({ kind: 'skip_only', provider: 'spotify' });
  });

  it('only offers to skip when the song isn’t on any service', () => {
    expect(
      planSong({
        playsThrough: 'spotify',
        availableOn: [],
        hostConnected: ['spotify', 'apple_music'],
      }),
    ).toEqual({ kind: 'skip_only', provider: 'spotify' });
  });

  it('offers a switch even when the room’s own service is no longer connected', () => {
    expect(
      planSong({
        playsThrough: 'spotify',
        availableOn: ['apple_music'],
        hostConnected: ['apple_music'],
      }),
    ).toEqual({ kind: 'offer_switch', from: 'spotify', to: 'apple_music' });
  });
});

describe('checkSwitch', () => {
  /** The host answering for Phantom, which is up, hasn't started and is only on Apple Music. */
  const ask = {
    isHost: true,
    forEntryId: 'phantom',
    upEntryId: 'phantom',
    songStarted: false,
    to: 'apple_music' as const,
    playsThrough: 'spotify' as const,
    availableOn: ['apple_music' as const],
    hostConnected: ['spotify' as const, 'apple_music' as const],
  };

  it('lets the host switch between songs', () => {
    expect(checkSwitch(ask)).toEqual({ ok: true, from: 'spotify', to: 'apple_music' });
  });

  it('refuses anyone but the host', () => {
    expect(checkSwitch({ ...ask, isHost: false })).toEqual({ ok: false, error: 'not_host' });
  });

  it('refuses an answer for a song that isn’t up any more', () => {
    expect(checkSwitch({ ...ask, upEntryId: 'next-song' })).toEqual({
      ok: false,
      error: 'stale_state',
    });
    expect(checkSwitch({ ...ask, upEntryId: null })).toEqual({ ok: false, error: 'stale_state' });
  });

  it('never switches in the middle of a song', () => {
    expect(checkSwitch({ ...ask, songStarted: true })).toEqual({
      ok: false,
      error: 'not_between_songs',
    });
  });

  it('needs the service to switch to connected', () => {
    expect(checkSwitch({ ...ask, hostConnected: ['spotify'] })).toEqual({
      ok: false,
      error: 'provider_required',
    });
  });

  it('refuses a switch the song doesn’t need', () => {
    // Already on the room's service.
    expect(checkSwitch({ ...ask, availableOn: ['spotify', 'apple_music'] })).toEqual({
      ok: false,
      error: 'not_needed',
    });
    // A replay after the switch: the room already plays through Apple Music.
    expect(checkSwitch({ ...ask, playsThrough: 'apple_music' })).toEqual({
      ok: false,
      error: 'not_needed',
    });
    // Not on the service to switch to either.
    expect(checkSwitch({ ...ask, availableOn: [] })).toEqual({ ok: false, error: 'not_needed' });
  });

  it('checks who’s asking before the room’s state', () => {
    expect(
      checkSwitch({ ...ask, isHost: false, upEntryId: null, songStarted: true }),
    ).toMatchObject({ error: 'not_host' });
    expect(checkSwitch({ ...ask, upEntryId: null, songStarted: true })).toMatchObject({
      error: 'stale_state',
    });
  });
});
