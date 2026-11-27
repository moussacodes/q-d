import type {
  QdMusicKitApi,
  QdMusicKitAuthorizationStatus,
  QdMusicKitAvailability,
  QdMusicKitCapabilities,
  QdMusicKitConnectionState,
  QdMusicKitErrorCode,
  QdMusicKitNativeModule,
  QdMusicKitPlayerState,
  QdMusicKitSubscription,
  QdMusicKitTrackRef,
} from './QdMusicKit.types';

/** A typed failure, so callers never get a silent no-op (API_CONTRACTS.md §5). */
export class QdMusicKitError extends Error {
  constructor(
    readonly code: QdMusicKitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QdMusicKitError';
  }
}

/** What an unavailable player can do: nothing. */
const NO_CAPABILITIES: QdMusicKitCapabilities = Object.freeze({
  inAppAudio: false,
  backgroundPlayback: false,
  requiresExternalApp: false,
  autoplay: false,
  isMock: false,
});

/** Native error codes the Swift module throws on purpose. */
const NATIVE_CODES: Record<string, QdMusicKitErrorCode> = {
  ERR_QD_NOT_IMPLEMENTED: 'not_implemented',
};

const CONNECTION_STATUSES = new Set([
  'connected',
  'needs_authorization',
  'needs_subscription',
  'app_not_installed',
]);
const PLAYER_STATUSES = new Set(['playing', 'paused', 'stopped']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkPosition(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new QdMusicKitError('invalid_argument', `${name} must be a finite number ≥ 0`);
  }
  return Math.round(value);
}

function checkTrack(track: QdMusicKitTrackRef): string {
  if (!isRecord(track)) throw new QdMusicKitError('invalid_argument', 'track is required');
  if (track.provider !== 'apple_music') {
    throw new QdMusicKitError('wrong_provider', 'Only Apple Music tracks play through MusicKit');
  }
  const id = typeof track.providerTrackId === 'string' ? track.providerTrackId.trim() : '';
  if (!id) throw new QdMusicKitError('invalid_argument', 'providerTrackId is required');
  return id;
}

/** Native errors become QdMusicKitError. Only the code and message cross over. */
function toError(error: unknown): QdMusicKitError {
  if (error instanceof QdMusicKitError) return error;
  const nativeCode = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
  const message = error instanceof Error ? error.message : 'MusicKit call failed';
  const code = (nativeCode && NATIVE_CODES[nativeCode]) || 'native_error';
  return new QdMusicKitError(code, message);
}

function toCapabilities(raw: unknown): QdMusicKitCapabilities {
  if (!isRecord(raw)) return NO_CAPABILITIES;
  // Only an explicit `true` counts, and the native player is never a mock.
  return {
    inAppAudio: raw.inAppAudio === true,
    backgroundPlayback: raw.backgroundPlayback === true,
    requiresExternalApp: raw.requiresExternalApp === true,
    autoplay: raw.autoplay === true,
    isMock: false,
  };
}

function toConnectionState(raw: unknown): QdMusicKitConnectionState {
  if (!isRecord(raw) || typeof raw.status !== 'string') {
    return { status: 'error', code: 'invalid_native_response' };
  }
  if (raw.status === 'error') {
    const code = typeof raw.code === 'string' && raw.code ? raw.code : 'native_error';
    return { status: 'error', code };
  }
  if (CONNECTION_STATUSES.has(raw.status)) {
    return { status: raw.status } as QdMusicKitConnectionState;
  }
  return { status: 'error', code: 'invalid_native_response' };
}

/** Apple's raw values (`notDetermined`) and ours (`not_determined`) are both accepted. */
const AUTHORIZATION_STATUSES: Record<string, QdMusicKitAuthorizationStatus> = {
  authorized: 'authorized',
  denied: 'denied',
  restricted: 'restricted',
  notDetermined: 'not_determined',
  not_determined: 'not_determined',
};

function toAuthorizationStatus(raw: unknown): QdMusicKitAuthorizationStatus {
  const status = typeof raw === 'string' ? AUTHORIZATION_STATUSES[raw] : undefined;
  if (!status) {
    throw new QdMusicKitError('invalid_native_response', 'MusicKit returned an unknown status');
  }
  return status;
}

function toSubscription(raw: unknown): QdMusicKitSubscription {
  if (
    !isRecord(raw) ||
    typeof raw.canPlayCatalogContent !== 'boolean' ||
    typeof raw.canBecomeSubscriber !== 'boolean'
  ) {
    throw new QdMusicKitError(
      'invalid_native_response',
      'MusicKit returned an unknown subscription',
    );
  }
  return {
    canPlayCatalogContent: raw.canPlayCatalogContent,
    canBecomeSubscriber: raw.canBecomeSubscriber,
  };
}

/** Two letters, lowercased; anything else is "no storefront known". */
function toStorefront(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

function toPlayerState(raw: unknown): QdMusicKitPlayerState {
  if (
    !isRecord(raw) ||
    typeof raw.status !== 'string' ||
    !PLAYER_STATUSES.has(raw.status) ||
    typeof raw.positionMs !== 'number' ||
    !Number.isFinite(raw.positionMs) ||
    raw.positionMs < 0 ||
    !(raw.providerTrackId == null || typeof raw.providerTrackId === 'string')
  ) {
    throw new QdMusicKitError('invalid_native_response', 'MusicKit returned an unknown state');
  }
  return {
    status: raw.status as QdMusicKitPlayerState['status'],
    providerTrackId: (raw.providerTrackId as string | null | undefined) || null,
    positionMs: Math.round(raw.positionMs),
  };
}

/**
 * Builds the wrapper around the native module, or around nothing.
 *
 * Without the native module (Expo Go, web, Android, Jest) or off iOS, the
 * wrapper reports `unavailable`: no capabilities, `connect()` resolves to
 * `{ status: 'error', code: 'unavailable' }`, and player calls throw
 * `QdMusicKitError('unavailable')`. It never pretends to play.
 */
export function createQdMusicKit(
  native: QdMusicKitNativeModule | null | undefined,
  platformOS: string,
): QdMusicKitApi {
  const availability: QdMusicKitAvailability =
    platformOS !== 'ios'
      ? { available: false, reason: 'unsupported_platform' }
      : native
        ? { available: true }
        : { available: false, reason: 'native_module_missing' };
  const player = availability.available ? native! : null;

  function requirePlayer(): QdMusicKitNativeModule {
    if (!player) {
      throw new QdMusicKitError(
        'unavailable',
        'Apple Music playback needs the q’d development build on an iPhone',
      );
    }
    return player;
  }

  /** A native method the Swift skeleton doesn't have yet is `not_implemented`. */
  async function optional<T>(
    name: 'authorizationStatus' | 'requestAuthorization' | 'subscriptionStatus' | 'storefront',
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const module = requirePlayer();
    const method = module[name];
    if (typeof method !== 'function') {
      throw new QdMusicKitError('not_implemented', `qd-music-kit: ${name} isn't implemented yet`);
    }
    let raw: unknown;
    try {
      raw = await method.call(module);
    } catch (error) {
      throw toError(error);
    }
    return parse(raw);
  }

  async function call<T>(run: (module: QdMusicKitNativeModule) => Promise<T>): Promise<T> {
    const module = requirePlayer();
    try {
      return await run(module);
    } catch (error) {
      throw toError(error);
    }
  }

  return {
    provider: 'apple_music',

    availability: () => availability,

    capabilities() {
      if (!player) return NO_CAPABILITIES;
      try {
        return toCapabilities(player.capabilities());
      } catch {
        return NO_CAPABILITIES;
      }
    },

    async connect() {
      if (!player) return { status: 'error', code: 'unavailable' };
      try {
        return toConnectionState(await player.connect());
      } catch (error) {
        return { status: 'error', code: toError(error).code };
      }
    },

    async prepare(track, startPositionMs = 0) {
      const id = checkTrack(track);
      const start = checkPosition('startPositionMs', startPositionMs);
      await call((m) => m.prepare(id, start));
    },

    play: () => call((m) => m.play()),

    pause: () => call((m) => m.pause()),

    async seek(positionMs) {
      const position = checkPosition('positionMs', positionMs);
      await call((m) => m.seek(position));
    },

    async enqueue(tracks) {
      if (!Array.isArray(tracks))
        throw new QdMusicKitError('invalid_argument', 'tracks must be a list');
      const ids = tracks.map(checkTrack);
      requirePlayer();
      // Nothing to add: valid, and there's no reason to cross the bridge.
      if (ids.length === 0) return;
      await call((m) => m.enqueue(ids));
    },

    getState: () => call(async (m) => toPlayerState(await m.getState())),

    async disconnect() {
      // Nothing is connected when there's no player, so there's nothing to undo.
      if (!player) return;
      await call((m) => m.disconnect());
    },

    authorizationStatus: () => optional('authorizationStatus', toAuthorizationStatus),

    requestAuthorization: () => optional('requestAuthorization', toAuthorizationStatus),

    subscription: () => optional('subscriptionStatus', toSubscription),

    storefront: () => optional('storefront', toStorefront),
  };
}
