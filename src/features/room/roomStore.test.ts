import { defaultRoomRules } from '@/domain/room-rules';
import { findRoom } from '@/providers/mock/data';

import { availableOn, createRoomStore, MOCK_START_MS, previewRoom, roomKey } from './roomStore';

const room = { code: 'QD-7K4F9X' };
const titles = (store: ReturnType<typeof createRoomStore>, ref = room) =>
  store.get(ref).queue.map((entry) => entry.title);

describe('room store', () => {
  it('starts a room from its sample data, part-way into the song', () => {
    const store = createRoomStore();
    const state = store.get(room);
    expect(state.nowPlaying?.title).toBe('Have a Baby (With Me)');
    expect(state.queue).toHaveLength(7);
    expect(state.startAtMs).toBe(MOCK_START_MS);
  });

  it('returns the same state until something changes, and tells subscribers when it does', () => {
    const store = createRoomStore();
    const listener = jest.fn();
    store.subscribe(listener);
    const before = store.get(room);
    expect(store.get(room)).toBe(before);

    store.remove(room, before.queue[0].entryId);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get(room)).not.toBe(before);
  });

  it('gives every entry its own id', () => {
    const ids = createRoomStore()
      .get(room)
      .queue.map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('add (enqueue_recording)', () => {
    const rainDown = { ...findRoom(room.code).queue[0], id: 's3', title: 'Rain Down' };

    it('adds the song at the end and says where it landed', () => {
      const store = createRoomStore();
      const result = store.enqueue(room, rainDown, 'Maya');
      expect(result).toEqual({
        ok: true,
        entryId: expect.any(String),
        playingNow: false,
        queueLength: 8,
      });
      const last = store.get(room).queue[7];
      expect(last.title).toBe('Rain Down');
      expect(last.addedBy).toBe('Maya');
    });

    it('asks before adding a song that’s already queued or playing', () => {
      const store = createRoomStore();
      const { nowPlaying, queue } = store.get(room);
      expect(store.enqueue(room, queue[1], 'Maya')).toEqual({
        ok: false,
        error: 'already_in_queue',
      });
      expect(store.enqueue(room, nowPlaying!, 'Maya')).toEqual({
        ok: false,
        error: 'already_in_queue',
      });
      expect(store.get(room).queue).toHaveLength(7);
    });

    it('adds it again once confirmed, as its own entry', () => {
      const store = createRoomStore();
      const always = store.get(room).queue[1];
      const result = store.enqueue(room, always, 'Maya', true);
      expect(result.ok).toBe(true);
      const copies = store.get(room).queue.filter((entry) => entry.title === always.title);
      expect(copies).toHaveLength(2);
      expect(copies[0].entryId).not.toBe(copies[1].entryId);
    });

    it('plays the song at once when nothing is playing', () => {
      const store = createRoomStore();
      const empty = { code: room.code, view: 'empty' as const };
      const result = store.enqueue(empty, rainDown, 'Maya');
      expect(result).toEqual({
        ok: true,
        entryId: expect.any(String),
        playingNow: true,
        queueLength: 0,
      });
      expect(store.get(empty).nowPlaying?.title).toBe('Rain Down');
      expect(store.get(empty).startAtMs).toBe(0);
    });

    it('can be taken back while it’s still queued', () => {
      const store = createRoomStore();
      const result = store.enqueue(room, rainDown, 'Maya');
      if (!result.ok) throw new Error('expected the add to work');
      expect(store.remove(room, result.entryId)).toBe(true);
      expect(store.get(room).queue).toHaveLength(7);
    });
  });

  describe('reorder (reorder_queue)', () => {
    it('moves an entry after another one, or to the top', () => {
      const store = createRoomStore();
      const [first, second, third] = store.get(room).queue;

      expect(store.move(room, first.entryId, third.entryId)).toBe(true);
      expect(titles(store).slice(0, 3)).toEqual([second.title, third.title, first.title]);

      expect(store.move(room, first.entryId, null)).toBe(true);
      expect(titles(store).slice(0, 3)).toEqual([first.title, second.title, third.title]);
    });

    it('refuses entries that aren’t queued', () => {
      const store = createRoomStore();
      const [first] = store.get(room).queue;
      const nowPlaying = store.get(room).nowPlaying!;
      expect(store.move(room, 'missing', null)).toBe(false);
      expect(store.move(room, first.entryId, 'missing')).toBe(false);
      expect(store.move(room, nowPlaying.entryId, null)).toBe(false);
      expect(store.move(room, first.entryId, first.entryId)).toBe(false);
    });
  });

  describe('remove (remove_queue_entry)', () => {
    it('takes the entry out of the queue', () => {
      const store = createRoomStore();
      const [first] = store.get(room).queue;
      expect(store.remove(room, first.entryId)).toBe(true);
      expect(titles(store)).not.toContain(first.title);
      expect(store.get(room).queue).toHaveLength(6);
    });

    it('refuses an entry that isn’t queued', () => {
      const store = createRoomStore();
      expect(store.remove(room, store.get(room).nowPlaying!.entryId)).toBe(false);
      expect(store.remove(room, 'missing')).toBe(false);
    });
  });

  describe('advance (advance_queue)', () => {
    it('plays the next song from the start', () => {
      const store = createRoomStore();
      const { nowPlaying, queue } = store.get(room);
      expect(store.advance(room, nowPlaying!.entryId, 'skipped')).toBe(true);
      expect(store.get(room).nowPlaying).toBe(queue[0]);
      expect(store.get(room).queue).toEqual(queue.slice(1));
      expect(store.get(room).startAtMs).toBe(0);
    });

    it('moves on once when two callers report the same song (stale_state)', () => {
      const store = createRoomStore();
      const playing = store.get(room).nowPlaying!.entryId;
      expect(store.advance(room, playing, 'skipped')).toBe(true);
      expect(store.advance(room, playing, 'ended')).toBe(false);
      expect(store.get(room).queue).toHaveLength(6);
    });

    it('leaves nothing playing when the queue runs out', () => {
      const store = createRoomStore();
      let playing = store.get(room).nowPlaying;
      while (playing) {
        store.advance(room, playing.entryId, 'ended');
        playing = store.get(room).nowPlaying;
      }
      expect(store.get(room).queue).toEqual([]);
    });
  });

  describe('rules (update_room_rules)', () => {
    const hostOnly = {
      addSongs: { who: 'host' as const, chosen: [] },
      control: { who: 'chosen' as const, chosen: ['maya'] },
    };

    it('starts a room with the default rules', () => {
      expect(createRoomStore().get(room).rules).toEqual(defaultRoomRules);
    });

    it('changes the rules and tells subscribers', () => {
      const store = createRoomStore();
      const listener = jest.fn();
      store.subscribe(listener);
      store.setRules(room, hostOnly);
      expect(store.get(room).rules).toEqual(hostOnly);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the rules while songs are added and move on', () => {
      const store = createRoomStore();
      store.setRules(room, hostOnly);
      store.advance(room, store.get(room).nowPlaying!.entryId, 'skipped');
      expect(store.get(room).rules).toEqual(hostOnly);

      const empty = { code: room.code, view: 'empty' as const };
      store.setRules(empty, hostOnly);
      store.enqueue(empty, findRoom(room.code).queue[0], 'Baron');
      expect(store.get(empty).nowPlaying).not.toBeNull();
      expect(store.get(empty).rules).toEqual(hostOnly);
    });

    it('shares the rules with the listener preview, which is the same room', () => {
      const store = createRoomStore();
      store.setRules(room, hostOnly);
      expect(store.get({ code: room.code, view: 'listener' }).rules).toEqual(hostOnly);
    });
  });

  describe('development previews', () => {
    it('keep queue-changing previews apart from the real room', () => {
      expect(roomKey({ code: room.code, view: 'empty' })).not.toBe(roomKey(room));
      expect(roomKey({ code: room.code, view: 'unavailable' })).not.toBe(roomKey(room));
      expect(roomKey({ code: room.code, view: 'uncertain' })).not.toBe(roomKey(room));
      expect(roomKey({ code: room.code, view: 'listener' })).toBe(roomKey(room));
      expect(roomKey({ code: room.code, view: 'apple' })).toBe(roomKey(room));

      const store = createRoomStore();
      const empty = { code: room.code, view: 'empty' as const };
      expect(store.get(empty).nowPlaying).toBeNull();
      expect(store.get(empty).queue).toEqual([]);
      expect(store.get(room).queue).toHaveLength(7);
    });

    it('show a song that isn’t on the host’s service for 4.3', () => {
      const shown = previewRoom(findRoom(room.code), 'unavailable');
      expect(shown.nowPlaying?.unavailableOn).toBe(shown.playsThrough);
      expect(shown.nowPlaying?.matches?.spotify?.providerTrackId).toBeNull();
    });

    it('show a song whose match on the host’s service is uncertain', () => {
      const shown = previewRoom(findRoom(room.code), 'uncertain');
      expect(shown.nowPlaying?.title).toBe('Way Bigger');
      expect(shown.nowPlaying?.matches?.spotify?.warning).toBe('low_confidence');
      expect(shown.queue.map((t) => t.title)).toEqual(['Butterflies', 'Heartbreak Anniversary']);
    });
  });

  describe('host presence (PRODUCT_SPEC.md §4)', () => {
    const clocked = () => {
      let now = 1_000_000;
      const store = createRoomStore(() => now);
      return {
        store,
        tick: (ms: number) => {
          now += ms;
        },
      };
    };

    it('starts with the host present and the room not paused', () => {
      const { store } = clocked();
      expect(store.get(room).host).toEqual({ present: true, lastSeenAt: 1_000_000 });
      expect(store.get(room).pausedForHost).toBe(false);
    });

    it('times the host leaving, and keeps that time while they stay away', () => {
      const { store, tick } = clocked();
      tick(5_000);
      store.setHostPresent(room, false);
      expect(store.get(room).host).toEqual({ present: false, lastSeenAt: 1_005_000 });
      tick(10_000);
      const listener = jest.fn();
      store.subscribe(listener);
      store.setHostPresent(room, false);
      expect(store.get(room).host.lastSeenAt).toBe(1_005_000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('ignores a repeat "present", so presence syncs cause no re-render', () => {
      const { store, tick } = clocked();
      const before = store.get(room);
      const listener = jest.fn();
      store.subscribe(listener);
      tick(1_000);
      store.setHostPresent(room, true);
      expect(store.get(room)).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    });

    it('keeps the queue and what’s playing while the host is away', () => {
      const { store } = clocked();
      const before = store.get(room);
      store.setHostPresent(room, false);
      expect(store.pauseForHost(room)).toBe(true);
      expect(store.get(room).nowPlaying).toEqual(before.nowPlaying);
      expect(store.get(room).queue).toEqual(before.queue);
      expect(store.get(room).pausedForHost).toBe(true);
      // Pausing twice changes nothing.
      expect(store.pauseForHost(room)).toBe(false);
    });

    it('lets only a host who is back resume, once', () => {
      const { store } = clocked();
      store.setHostPresent(room, false);
      store.pauseForHost(room);
      expect(store.resumeAfterHost(room)).toBe(false);
      expect(store.get(room).pausedForHost).toBe(true);

      store.setHostPresent(room, true);
      expect(store.get(room).pausedForHost).toBe(true);
      expect(store.resumeAfterHost(room)).toBe(true);
      expect(store.get(room).pausedForHost).toBe(false);
      expect(store.resumeAfterHost(room)).toBe(false);
    });

    it('has nothing to resume when the room never paused', () => {
      const { store } = clocked();
      expect(store.resumeAfterHost(room)).toBe(false);
    });

    it('seeds the host previews apart from the real room', () => {
      const { store } = clocked();
      const reconnecting = { code: room.code, view: 'reconnecting' as const };
      const away = { code: room.code, view: 'host-away' as const };
      const back = { code: room.code, view: 'host-back' as const };
      for (const ref of [reconnecting, away, back]) {
        expect(roomKey(ref)).not.toBe(roomKey(room));
      }
      expect(store.get(reconnecting).host).toEqual({ present: false, lastSeenAt: 1_000_000 });
      expect(store.get(reconnecting).pausedForHost).toBe(false);
      expect(store.get(away).host.present).toBe(false);
      expect(1_000_000 - store.get(away).host.lastSeenAt!).toBeGreaterThan(30_000);
      expect(store.get(away).pausedForHost).toBe(true);
      expect(store.get(back)).toMatchObject({ host: { present: true }, pausedForHost: true });
      expect(store.get(room)).toMatchObject({ host: { present: true }, pausedForHost: false });
    });
  });
});

describe('switch_playback_provider', () => {
  // The 4.3 preview: "Phantom" is up and isn't on Spotify.
  const preview = { code: 'QD-7K4F9X', view: 'unavailable' as const };
  const request = (store: ReturnType<typeof createRoomStore>) => ({
    forEntryId: store.get(preview).nowPlaying!.entryId,
    to: 'apple_music' as const,
    isHost: true,
    songStarted: false,
    playsThrough: 'spotify' as const,
    hostConnected: ['spotify' as const, 'apple_music' as const],
  });

  describe('which services a song can start on (its stored matches)', () => {
    const queue = createRoomStore().get({ code: 'QD-7K4F9X' }).queue;
    const byTitle = (title: string) => queue.find((entry) => entry.title === title)!;

    it('leaves out a service whose match says it doesn’t have the song', () => {
      expect(availableOn(byTitle('Phantom'))).toEqual(['apple_music']);
    });

    it('keeps a low-confidence match: it plays with its warning', () => {
      const wayBigger = byTitle('Way Bigger');
      expect(wayBigger.matches?.spotify?.warning).toBe('low_confidence');
      expect(availableOn(wayBigger)).toContain('spotify');
    });

    it('never counts a song with no match yet, instead of guessing', () => {
      expect(availableOn({})).toEqual([]);
      expect(availableOn({ matches: { spotify: undefined } })).toEqual([]);
    });

    it('counts a song matched on both services on both', () => {
      expect(availableOn(byTitle('Lovers Rock'))).toEqual(['spotify', 'apple_music']);
    });
  });

  it('switches the room for the song that’s up, from its start, and says so', () => {
    const store = createRoomStore();
    const listener = jest.fn();
    store.subscribe(listener);
    const ask = request(store);
    expect(store.get(preview).playsThrough).toBeNull();

    expect(store.switchProvider(preview, ask)).toEqual({ ok: true });
    const after = store.get(preview);
    expect(after.playsThrough).toBe('apple_music');
    expect(after.switched).toEqual({ entryId: ask.forEntryId, from: 'spotify', to: 'apple_music' });
    expect(after.startAtMs).toBe(0);
    expect(after.nowPlaying?.entryId).toBe(ask.forEntryId);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the same answer comes again', () => {
    const store = createRoomStore();
    const ask = request(store);
    store.switchProvider(preview, ask);
    const after = store.get(preview);
    expect(store.switchProvider(preview, { ...ask, playsThrough: 'apple_music' })).toEqual({
      ok: false,
      error: 'not_needed',
    });
    expect(store.get(preview)).toBe(after);
  });

  it.each([
    ['not_host', { isHost: false }],
    ['not_between_songs', { songStarted: true }],
    ['provider_required', { hostConnected: ['spotify' as const] }],
    ['stale_state', { forEntryId: 'gone' }],
  ] as const)('refuses with %s and leaves the room alone', (error, change) => {
    const store = createRoomStore();
    const before = store.get(preview);
    expect(store.switchProvider(preview, { ...request(store), ...change })).toEqual({
      ok: false,
      error,
    });
    expect(store.get(preview)).toBe(before);
  });

  it('refuses once the song was skipped', () => {
    const store = createRoomStore();
    const ask = request(store);
    store.advance(preview, ask.forEntryId, 'skipped');
    expect(store.switchProvider(preview, ask)).toEqual({ ok: false, error: 'stale_state' });
    expect(store.get(preview).playsThrough).toBeNull();
  });

  it('refuses for a song that’s on the room’s service', () => {
    const store = createRoomStore();
    const ask = { ...request(store), forEntryId: store.get(room).nowPlaying!.entryId };
    expect(store.switchProvider(room, ask)).toEqual({ ok: false, error: 'not_needed' });
  });

  it('keeps the previews apart from the real room', () => {
    const store = createRoomStore();
    store.switchProvider(preview, request(store));
    expect(store.get(room).playsThrough).toBeNull();
  });
});

describe('provider autoplay', () => {
  /** The sample room with only the playing song left. */
  const lastSong = () => {
    const store = createRoomStore();
    store.get(room).queue.forEach((entry) => store.remove(room, entry.entryId));
    return store;
  };

  it('records the service that kept playing when the last song ended', () => {
    const store = lastSong();
    const playing = store.get(room).nowPlaying!.entryId;
    expect(store.advance(room, playing, 'ended', 'spotify')).toBe(true);
    expect(store.get(room)).toMatchObject({ nowPlaying: null, autoplay: 'spotify' });
  });

  it('ignores autoplay while songs are queued: the queue comes first', () => {
    const store = createRoomStore();
    store.advance(room, store.get(room).nowPlaying!.entryId, 'ended', 'spotify');
    expect(store.get(room).autoplay).toBeNull();
    expect(store.get(room).nowPlaying?.title).toBe('Lovers Rock');
  });

  it('doesn’t autoplay after a skip, or when the service stopped', () => {
    const skipped = lastSong();
    skipped.advance(room, skipped.get(room).nowPlaying!.entryId, 'skipped', 'spotify');
    expect(skipped.get(room).autoplay).toBeNull();

    const stopped = lastSong();
    stopped.advance(room, stopped.get(room).nowPlaying!.entryId, 'ended');
    expect(stopped.get(room).autoplay).toBeNull();
  });

  it('hands the room back to the queue when someone adds a song', () => {
    const store = lastSong();
    store.advance(room, store.get(room).nowPlaying!.entryId, 'ended', 'apple_music');
    const song = { ...findRoom('QD-9M2XR4').nowPlaying!, id: 'new' };
    expect(store.enqueue(room, song, 'Maya')).toMatchObject({ ok: true, playingNow: true });
    expect(store.get(room)).toMatchObject({ autoplay: null, nowPlaying: { id: 'new' } });
  });

  it('forgets autoplay when the provider stops, telling subscribers once', () => {
    const store = lastSong();
    store.advance(room, store.get(room).nowPlaying!.entryId, 'ended', 'spotify');
    const listener = jest.fn();
    store.subscribe(listener);
    store.stopAutoplay(room);
    store.stopAutoplay(room);
    expect(store.get(room).autoplay).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('Realtime stand-ins (mock mode)', () => {
  const ref = { code: 'QD-7K4F9X' };

  it('ends the room once, stopping autoplay, and keeps the queue', () => {
    const store = createRoomStore();
    const queue = store.get(ref).queue;
    expect(store.endRoom(ref)).toBe(true);
    expect(store.endRoom(ref)).toBe(false);
    expect(store.get(ref)).toMatchObject({ ended: true, autoplay: null });
    expect(store.get(ref).queue).toEqual(queue);
  });

  it('marks this phone offline and back, without touching the host for a listener', () => {
    const store = createRoomStore(() => 5_000);
    const host = store.get(ref).host;
    store.setOffline(ref, true, { isHost: false });
    expect(store.get(ref)).toMatchObject({ offline: true, host });
    store.setOffline(ref, false, { isHost: false });
    expect(store.get(ref).offline).toBe(false);
  });

  it('on the host’s phone, offline is the host leaving presence, and back is returning', () => {
    let now = 5_000;
    const store = createRoomStore(() => now);
    store.setOffline(ref, true, { isHost: true });
    expect(store.get(ref).host).toEqual({ present: false, lastSeenAt: 5_000 });
    now = 9_000;
    store.setOffline(ref, false, { isHost: true });
    expect(store.get(ref).host).toEqual({ present: true, lastSeenAt: 9_000 });
  });

  it('does nothing when the connection doesn’t change', () => {
    const store = createRoomStore();
    const listener = jest.fn();
    store.subscribe(listener);
    store.setOffline(ref, false, { isHost: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
