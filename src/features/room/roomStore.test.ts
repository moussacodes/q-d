import { defaultRoomRules } from '@/domain/room-rules';
import { findRoom } from '@/providers/mock/data';

import { createRoomStore, MOCK_START_MS, previewRoom, roomKey } from './roomStore';

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

  describe('name (rename_room)', () => {
    it('keeps the name the room started with until the host renames it', () => {
      expect(createRoomStore().get(room).name).toBeNull();
    });

    it('renames the room, trimmed, and tells subscribers', () => {
      const store = createRoomStore();
      const listener = jest.fn();
      store.subscribe(listener);
      expect(store.rename(room, '  Friday Night ')).toBe(true);
      expect(store.get(room).name).toBe('Friday Night');
      expect(listener).toHaveBeenCalledTimes(1);

      // The same name again changes nothing.
      expect(store.rename(room, 'Friday Night')).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('refuses a blank name', () => {
      const store = createRoomStore();
      store.rename(room, 'Friday Night');
      expect(store.rename(room, '   ')).toBe(false);
      expect(store.get(room).name).toBe('Friday Night');
    });

    it('keeps the name while songs move on, and shares it with the listener preview', () => {
      const store = createRoomStore();
      store.rename(room, 'Friday Night');
      store.advance(room, store.get(room).nowPlaying!.entryId, 'skipped');
      expect(store.get(room).name).toBe('Friday Night');
      expect(store.get({ code: room.code, view: 'listener' }).name).toBe('Friday Night');
    });
  });

  describe('development previews', () => {
    it('keep queue-changing previews apart from the real room', () => {
      expect(roomKey({ code: room.code, view: 'empty' })).not.toBe(roomKey(room));
      expect(roomKey({ code: room.code, view: 'unavailable' })).not.toBe(roomKey(room));
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
    });
  });
});
