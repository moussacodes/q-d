import type { MusicProvider } from './music-provider';

/**
 * Switching the service a room plays through (docs/PRODUCT_SPEC.md §6, "Song
 * not on the host's service"). When the song that's up isn't on the room's
 * service but is on another one the host has connected, the host is asked
 * whether to switch or skip. q’d never switches on its own, and a switch only
 * happens between songs, never in the middle of one.
 */

/** Display order, so the choice is the same on every phone. */
const order: readonly MusicProvider[] = ['spotify', 'apple_music'];

/** What the host's phone can do with the song that's up. */
export type SongPlan =
  /** It's on the room's service: play it. */
  | { kind: 'play'; provider: MusicProvider }
  /** It isn't, but it's on `to`, which the host has connected: ask the host. */
  | { kind: 'offer_switch'; from: MusicProvider; to: MusicProvider }
  /** It isn't on any service the host has connected: the host can only skip it. */
  | { kind: 'skip_only'; provider: MusicProvider };

export function planSong({
  playsThrough,
  availableOn,
  hostConnected,
}: {
  /** The service the room plays through now. */
  playsThrough: MusicProvider;
  /** The services the song is on. */
  availableOn: readonly MusicProvider[];
  /** The services the host has connected on their phone. */
  hostConnected: readonly MusicProvider[];
}): SongPlan {
  if (availableOn.includes(playsThrough)) return { kind: 'play', provider: playsThrough };
  const to = order.find(
    (provider) =>
      provider !== playsThrough &&
      availableOn.includes(provider) &&
      hostConnected.includes(provider),
  );
  return to
    ? { kind: 'offer_switch', from: playsThrough, to }
    : { kind: 'skip_only', provider: playsThrough };
}

/**
 * Why a switch was refused. Codes match docs/API_CONTRACTS.md §2:
 * - `not_host`: only the host's phone plays, so only the host switches.
 * - `stale_state`: the song the host answered for isn't the one that's up any more.
 * - `not_between_songs`: the song has started; services never change mid-song.
 * - `provider_required`: the host hasn't connected the service to switch to.
 * - `not_needed`: the song is on the room's service already, or isn't on `to`.
 */
export type SwitchError =
  'not_host' | 'stale_state' | 'not_between_songs' | 'provider_required' | 'not_needed';

export type SwitchCheck =
  { ok: true; from: MusicProvider; to: MusicProvider } | { ok: false; error: SwitchError };

/**
 * Whether the host may switch the room to `to` for the song `forEntryId`.
 * Checked in the RPC's order: who's asking, the room's state, then the
 * operation's own rules.
 */
export function checkSwitch({
  isHost,
  forEntryId,
  upEntryId,
  songStarted,
  to,
  playsThrough,
  availableOn,
  hostConnected,
}: {
  isHost: boolean;
  /** The song the host was asked about. */
  forEntryId: string;
  /** The song that's up now, or null with nothing up. */
  upEntryId: string | null;
  /** The song that's up has started playing. */
  songStarted: boolean;
  to: MusicProvider;
  playsThrough: MusicProvider;
  availableOn: readonly MusicProvider[];
  hostConnected: readonly MusicProvider[];
}): SwitchCheck {
  if (!isHost) return { ok: false, error: 'not_host' };
  if (upEntryId !== forEntryId) return { ok: false, error: 'stale_state' };
  if (songStarted) return { ok: false, error: 'not_between_songs' };
  if (!hostConnected.includes(to)) return { ok: false, error: 'provider_required' };
  const plan = planSong({ playsThrough, availableOn, hostConnected });
  if (plan.kind !== 'offer_switch' || plan.to !== to) return { ok: false, error: 'not_needed' };
  return { ok: true, from: playsThrough, to };
}
