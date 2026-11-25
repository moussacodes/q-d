import type { MusicProvider } from '@/domain/music-provider';
import type { PlaybackCapabilities } from '@/domain/playback';

import { ProviderError } from './errors';
import type {
  CatalogAdapter,
  ConnectionState,
  PlaybackAdapter,
  PlayerState,
  ProviderEntity,
  ProviderTrack,
} from './types';

/**
 * Stand-ins for a real provider adapter that isn't in this build yet. They
 * say so instead of pretending: `connect` reports `not_in_this_build`, every
 * other call rejects with that code, and they claim no capability at all.
 * The Apple Music and Spotify cards replace them once their integrations have
 * been tested on a real device.
 */

const noCapabilities: PlaybackCapabilities = Object.freeze({
  inAppAudio: false,
  backgroundPlayback: false,
  requiresExternalApp: false,
  autoplay: false,
  isMock: false,
});

function notInThisBuild(provider: MusicProvider): Promise<never> {
  return Promise.reject(
    new ProviderError(
      'not_in_this_build',
      provider,
      `${provider} isn't available in this build of q’d yet`,
    ),
  );
}

export class UnavailableCatalogAdapter implements CatalogAdapter {
  constructor(readonly provider: MusicProvider) {}

  search(): Promise<never> {
    return notInThisBuild(this.provider);
  }

  resolveLink(): Promise<ProviderEntity> {
    return notInThisBuild(this.provider);
  }

  getTrack(): Promise<ProviderTrack> {
    return notInThisBuild(this.provider);
  }
}

export class UnavailablePlaybackAdapter implements PlaybackAdapter {
  constructor(readonly provider: MusicProvider) {}

  capabilities(): PlaybackCapabilities {
    return { ...noCapabilities };
  }

  async connect(): Promise<ConnectionState> {
    return { status: 'error', code: 'not_in_this_build', isMock: false };
  }

  prepare(): Promise<void> {
    return notInThisBuild(this.provider);
  }

  play(): Promise<void> {
    return notInThisBuild(this.provider);
  }

  pause(): Promise<void> {
    return notInThisBuild(this.provider);
  }

  seek(): Promise<void> {
    return notInThisBuild(this.provider);
  }

  enqueue(): Promise<void> {
    return notInThisBuild(this.provider);
  }

  getState(): Promise<PlayerState> {
    return notInThisBuild(this.provider);
  }

  /** Nothing is connected, so there's nothing to undo. */
  async disconnect(): Promise<void> {}
}
