import { z } from 'zod';

import type { MusicProvider } from '@/domain/music-provider';

import { log } from './logger';
import { secureKeyValue } from './secureStore';
import type { SecureKeyValue } from './secureStore.types';

/**
 * Music-service credentials on this device (docs/ARCHITECTURE.md §4.11).
 *
 * Connecting Apple Music or Spotify is separate from q’d sign-in. Its tokens
 * stay on the device in SecureStore (the iOS Keychain). They never go to
 * Supabase: `provider_connections` holds metadata only. They never reach
 * logs either: errors here are logged with no values.
 */

export const providerCredentialsSchema = z.object({
  /** Spotify access token, or the Apple Music user token. */
  accessToken: z.string().min(1),
  /** Spotify only. */
  refreshToken: z.string().min(1).optional(),
  /** When `accessToken` expires, in milliseconds since 1970. */
  expiresAt: z.number().int().positive().optional(),
  /** Granted scopes, space-separated. */
  scope: z.string().optional(),
});

export type ProviderCredentials = z.infer<typeof providerCredentialsSchema>;

const PROVIDERS: readonly MusicProvider[] = ['apple_music', 'spotify'];

/** Large values are a mistake (SecureStore entries are meant to be small). */
const MAX_STORED_LENGTH = 8 * 1024;

/** SecureStore keys allow letters, digits, `.`, `-` and `_`. */
export function credentialKey(provider: MusicProvider): string {
  return `qd.provider.${provider}`;
}

export class ProviderCredentialsError extends Error {
  constructor(
    readonly code: 'unknown_provider' | 'invalid_credentials' | 'too_large' | 'storage_failed',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderCredentialsError';
  }
}

function assertProvider(provider: string): asserts provider is MusicProvider {
  if (!PROVIDERS.includes(provider as MusicProvider)) {
    throw new ProviderCredentialsError('unknown_provider', 'Only Apple Music and Spotify connect.');
  }
}

const credentialLog = log.child('providerCredentials');

export interface ProviderCredentialStore {
  /** Whether credentials survive an app restart here (false on the web). */
  readonly persistent: boolean;
  save(provider: MusicProvider, credentials: ProviderCredentials): Promise<void>;
  /** The saved credentials, or null if there are none or they can't be read. */
  load(provider: MusicProvider): Promise<ProviderCredentials | null>;
  /**
   * Like `load`, but tells "nothing usable stored" (`none`) from "storage
   * can't be read right now" (`unreadable`, e.g. the Keychain before the
   * first unlock), so a check never takes a locked Keychain for a
   * disconnected service.
   */
  peek(provider: MusicProvider): Promise<'stored' | 'none' | 'unreadable'>;
  clear(provider: MusicProvider): Promise<void>;
  /** Removes every provider's credentials, e.g. on sign-out or account deletion. */
  clearAll(): Promise<void>;
}

export function createProviderCredentialStore(storage: SecureKeyValue): ProviderCredentialStore {
  const remove = async (provider: MusicProvider) => {
    assertProvider(provider);
    try {
      await storage.deleteItem(credentialKey(provider));
    } catch (error) {
      credentialLog.error('Could not delete credentials', error, { provider });
      throw new ProviderCredentialsError('storage_failed', 'Could not delete credentials.');
    }
  };

  return {
    persistent: storage.persistent,

    async save(provider, credentials) {
      assertProvider(provider);
      const parsed = providerCredentialsSchema.safeParse(credentials);
      if (!parsed.success) {
        throw new ProviderCredentialsError('invalid_credentials', 'Credentials are incomplete.');
      }
      const value = JSON.stringify(parsed.data);
      if (value.length > MAX_STORED_LENGTH) {
        throw new ProviderCredentialsError('too_large', 'Credentials are too large to store.');
      }
      try {
        await storage.setItem(credentialKey(provider), value);
      } catch (error) {
        credentialLog.error('Could not save credentials', error, { provider });
        throw new ProviderCredentialsError('storage_failed', 'Could not save credentials.');
      }
    },

    async load(provider) {
      assertProvider(provider);
      let value: string | null;
      try {
        value = await storage.getItem(credentialKey(provider));
      } catch (error) {
        // Keychain unavailable (e.g. before the first unlock): act as not
        // connected rather than crash. The person can reconnect.
        credentialLog.warn('Could not read credentials', { provider, error });
        return null;
      }
      if (value === null) return null;

      let json: unknown;
      try {
        json = JSON.parse(value);
      } catch {
        json = undefined;
      }
      const parsed = providerCredentialsSchema.safeParse(json);
      if (parsed.success) return parsed.data;

      // Corrupt or from an older format: forget it so the person reconnects.
      credentialLog.warn('Discarded unreadable credentials', { provider });
      await remove(provider).catch(() => {});
      return null;
    },

    async peek(provider) {
      assertProvider(provider);
      try {
        await storage.getItem(credentialKey(provider));
      } catch {
        // Logged by `load` when it's read for real; nothing to add here.
        return 'unreadable';
      }
      return (await this.load(provider)) === null ? 'none' : 'stored';
    },

    clear: remove,

    async clearAll() {
      const results = await Promise.allSettled(PROVIDERS.map((provider) => remove(provider)));
      if (results.some((result) => result.status === 'rejected')) {
        throw new ProviderCredentialsError('storage_failed', 'Could not delete every credential.');
      }
    },
  };
}

/**
 * Whether `credentials` have expired, or will within `skewMs`. Credentials
 * without an expiry count as valid.
 */
export function credentialsExpired(
  credentials: ProviderCredentials,
  now: number = Date.now(),
  skewMs = 60_000,
): boolean {
  return credentials.expiresAt !== undefined && credentials.expiresAt - skewMs <= now;
}

/** The app's store: SecureStore on devices, memory only on the web. */
export const providerCredentials: ProviderCredentialStore =
  createProviderCredentialStore(secureKeyValue);
