import type { PlaybackCapabilities } from '@/domain/playback';
import { providerTrackSchema } from '@/domain/recording';

import { isProviderError, ProviderError } from '../errors';
import type { ConnectionState, PlaybackAdapter, PlayerState, ProviderTrack } from '../types';
import { spotifyReason, type SpotifyApi } from './api';
import type { SpotifyAuth } from './auth';
import { spotifyConnectionStatus } from './connection';

/**
 * Spotify playback for `aux`: q’d remote-controls the Spotify app that's open
 * on the host's phone (or another active Spotify client) through the Web API.
 * The Spotify app plays the audio; q’d never streams, relays or rebroadcasts
 * it. Built, untested on a device or against real Spotify.
 *
 * - `prepare` only remembers the track and position: Spotify has no "load
 *   without playing", and starting then pausing would play audio. `play`
 *   starts it (`PUT /me/player/play` with the track URI and position).
 * - With no active Spotify app, `play` looks at the device list, moves
 *   playback to this phone's Spotify (or the only device) and plays there.
 *   If there's none, it fails with `no_active_device`.
 * - `getState` reads Spotify's player each time it's called; the caller polls.
 */

/** The Spotify app plays, and nothing beyond that has been checked on a device. */
export const spotifyCapabilities: PlaybackCapabilities = Object.freeze({
  inAppAudio: false,
  // Not claimed until it's tested with the screen locked.
  backgroundPlayback: false,
  requiresExternalApp: true,
  // Spotify's autoplay is a per-account setting q’d can't read.
  autoplay: false,
  isMock: false,
});

type SpotifyDevice = {
  id: string | null;
  is_active?: boolean;
  is_restricted?: boolean;
  type?: string;
};

const idle: PlayerState = Object.freeze({ status: 'idle', track: null, positionMs: 0 });

const uriFor = (track: ProviderTrack) => `spotify:track:${track.providerTrackId}`;

/** Spotify's track object → `ProviderTrack`, or null if it isn't a usable track. */
export function trackFromSpotify(item: unknown): ProviderTrack | null {
  if (!item || typeof item !== 'object') return null;
  const value = item as Record<string, unknown>;
  if (value.type !== undefined && value.type !== 'track') return null;
  const album = (value.album ?? {}) as Record<string, unknown>;
  const images = Array.isArray(album.images) ? (album.images as { url?: unknown }[]) : [];
  const externalIds = (value.external_ids ?? {}) as Record<string, unknown>;
  const isrc =
    typeof externalIds.isrc === 'string' ? externalIds.isrc.replace(/-/g, '').toUpperCase() : null;
  const parsed = providerTrackSchema.safeParse({
    provider: 'spotify',
    providerTrackId: value.id,
    title: value.name,
    artists: Array.isArray(value.artists)
      ? (value.artists as { name?: unknown }[]).map((artist) => artist?.name)
      : [],
    album: typeof album.name === 'string' && album.name ? album.name : null,
    durationMs: value.duration_ms,
    isrc,
    explicit: value.explicit === true,
    artworkUrl: typeof images[0]?.url === 'string' ? images[0].url : null,
    // Spotify supplies no artwork color q’d may use (ARCHITECTURE.md §4.2).
    artworkBackgroundColor: null,
  });
  if (parsed.success) return parsed.data;
  // An ISRC in a shape the schema rejects shouldn't hide the track.
  if (isrc !== null) return trackFromSpotify({ ...value, external_ids: {} });
  return null;
}

export type SpotifyPlaybackDeps = {
  auth: SpotifyAuth;
  api: SpotifyApi;
};

export class SpotifyPlaybackAdapter implements PlaybackAdapter {
  readonly provider = 'spotify' as const;
  /** Loaded by `prepare`, not started yet. */
  private pending: { track: ProviderTrack; positionMs: number } | null = null;
  /** Enqueued while a track was pending; sent to Spotify once it plays. */
  private held: ProviderTrack[] = [];
  /** What q’d last started, and what it queued, to report as q’d's own tracks. */
  private current: ProviderTrack | null = null;
  private queued: ProviderTrack[] = [];
  /** After `disconnect`, q’d controls nothing until it connects or prepares again. */
  private released = false;
  /** The device q’d moved playback to, if it had to. */
  private deviceId: string | undefined;

  constructor(private readonly deps: SpotifyPlaybackDeps) {}

  capabilities(): PlaybackCapabilities {
    return { ...spotifyCapabilities };
  }

  async connect(): Promise<ConnectionState> {
    this.released = false;
    return spotifyConnectionStatus(this.deps.auth, this.deps.api);
  }

  async prepare(track: ProviderTrack, startPositionMs = 0) {
    this.check(track);
    this.checkPosition(startPositionMs);
    this.released = false;
    this.pending = { track, positionMs: this.clamp(startPositionMs, track) };
  }

  async play() {
    if (this.pending) {
      const { track, positionMs } = this.pending;
      await this.withDevice((deviceId) =>
        this.deps.api.request({
          method: 'PUT',
          path: '/me/player/play',
          query: { device_id: deviceId },
          body: { uris: [uriFor(track)], position_ms: positionMs },
        }),
      );
      this.pending = null;
      this.current = track;
      this.queued = [];
      const held = this.held;
      this.held = [];
      await this.sendToQueue(held);
      return;
    }
    // Nothing prepared and nothing q’d started: stay idle.
    if (!this.current || this.released) return;
    try {
      await this.deps.api.request({
        method: 'PUT',
        path: '/me/player/play',
        query: { device_id: this.deviceId },
      });
    } catch (error) {
      if (spotifyReason(error) !== 'ALREADY_PLAYING') throw error;
    }
  }

  async pause() {
    // A track prepared while another plays: the old one is still audible in
    // the Spotify app, so pausing must still reach Spotify.
    if (!this.current || this.released) return;
    try {
      await this.deps.api.request({
        method: 'PUT',
        path: '/me/player/pause',
        query: { device_id: this.deviceId },
      });
    } catch (error) {
      // Already paused, or no Spotify app playing at all: either way it's not playing.
      const code = isProviderError(error) ? error.code : undefined;
      if (spotifyReason(error) !== 'ALREADY_PAUSED' && code !== 'no_active_device') throw error;
    }
  }

  async seek(positionMs: number) {
    this.checkPosition(positionMs);
    if (this.pending) {
      this.pending.positionMs = this.clamp(positionMs, this.pending.track);
      return;
    }
    if (!this.current || this.released) return;
    await this.deps.api.request({
      method: 'PUT',
      path: '/me/player/seek',
      query: { position_ms: this.clamp(positionMs, this.current), device_id: this.deviceId },
    });
  }

  /**
   * Adds tracks to Spotify's queue. Spotify's queue can't be reordered or
   * cleared through the Web API, so callers should enqueue only what plays
   * next and keep the room's queue in Postgres.
   */
  async enqueue(tracks: ProviderTrack[]) {
    tracks.forEach((track) => this.check(track));
    // After `disconnect` q’d sends nothing to Spotify: hold them for the next play.
    if (this.pending || this.released) {
      this.held.push(...tracks);
      return;
    }
    await this.sendToQueue(tracks);
  }

  async getState(): Promise<PlayerState> {
    if (this.released) return { ...idle };
    if (this.pending) {
      return { status: 'paused', track: this.pending.track, positionMs: this.pending.positionMs };
    }
    const { data } = await this.deps.api.request({ method: 'GET', path: '/me/player' });
    // 204: no Spotify app is playing anything.
    if (!data || typeof data !== 'object') return { ...idle };
    const player = data as { is_playing?: unknown; progress_ms?: unknown; item?: unknown };
    const remote = trackFromSpotify(player.item);
    if (!remote) return { ...idle };
    const track = this.own(remote);
    const progress =
      typeof player.progress_ms === 'number' && Number.isFinite(player.progress_ms)
        ? Math.max(0, Math.round(player.progress_ms))
        : 0;
    return {
      status: player.is_playing === true ? 'playing' : 'paused',
      track,
      positionMs: Math.min(progress, track.durationMs),
    };
  }

  /** Stops what q’d started and lets go. The Spotify account stays connected. */
  async disconnect() {
    const wasPlaying = this.current !== null && !this.released;
    this.pending = null;
    this.held = [];
    this.released = true;
    if (wasPlaying) {
      try {
        await this.deps.api.request({
          method: 'PUT',
          path: '/me/player/pause',
          query: { device_id: this.deviceId },
        });
      } catch {
        // Best effort: nothing to undo if Spotify is already paused or gone.
      }
    }
    this.current = null;
    this.queued = [];
    this.deviceId = undefined;
  }

  /** q’d's own copy of a track it started or queued, so its metadata stays as matched. */
  private own(remote: ProviderTrack): ProviderTrack {
    const mine = [this.current, ...this.queued].find(
      (track) => track?.providerTrackId === remote.providerTrackId,
    );
    return mine ?? remote;
  }

  private async sendToQueue(tracks: ProviderTrack[]) {
    for (const track of tracks) {
      await this.deps.api.request({
        method: 'POST',
        path: '/me/player/queue',
        query: { uri: uriFor(track), device_id: this.deviceId },
      });
      this.queued.push(track);
    }
  }

  /**
   * Runs `command` on the active device. With none, picks this phone's
   * Spotify, moves playback there, and runs it again.
   */
  private async withDevice(command: (deviceId: string | undefined) => Promise<unknown>) {
    try {
      await command(this.deviceId);
      return;
    } catch (error) {
      if (!isProviderError(error) || error.code !== 'no_active_device') throw error;
    }
    const deviceId = await this.pickDevice();
    await this.deps.api.request({
      method: 'PUT',
      path: '/me/player',
      body: { device_ids: [deviceId], play: false },
    });
    this.deviceId = deviceId;
    await command(deviceId);
  }

  /**
   * The device to play on: the active one, else this phone's Spotify
   * (`Smartphone`), else the only one there is. Never a guess between
   * several, which could start music on someone else's speaker.
   */
  private async pickDevice(): Promise<string> {
    const { data } = await this.deps.api.request({ method: 'GET', path: '/me/player/devices' });
    const list = (data as { devices?: unknown } | undefined)?.devices;
    const devices = (Array.isArray(list) ? (list as SpotifyDevice[]) : []).filter(
      (device): device is SpotifyDevice & { id: string } =>
        typeof device?.id === 'string' && device.id !== '' && device.is_restricted !== true,
    );
    const phones = devices.filter((device) => device.type === 'Smartphone');
    const choice =
      devices.find((device) => device.is_active) ??
      (phones.length === 1 ? phones[0] : undefined) ??
      (devices.length === 1 ? devices[0] : undefined);
    if (!choice) {
      throw new ProviderError('no_active_device', 'spotify', 'Open Spotify on this phone');
    }
    return choice.id;
  }

  private check(track: ProviderTrack) {
    if (track.provider !== 'spotify') {
      throw new ProviderError('wrong_provider', 'spotify', 'Track is from another provider');
    }
  }

  private checkPosition(positionMs: number) {
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw new ProviderError('invalid_argument', 'spotify', 'Position must be ms ≥ 0');
    }
  }

  private clamp(positionMs: number, track: ProviderTrack) {
    return Math.min(Math.round(positionMs), track.durationMs);
  }
}
