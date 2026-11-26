import type { MusicProvider } from './music-provider';

/**
 * `provider_connections` rows and what this phone actually holds
 * (DECISIONS.md, "Record real provider connections"). A row tells
 * `create_room` that the account can play through a service. The tokens that
 * make that true stay on the phone (SecureStore), so the app keeps the row
 * honest: it writes one only after a real connect succeeds, and removes it
 * when the phone no longer has a usable connection.
 */

/**
 * What this phone knows about a service at startup.
 * - `usable`: real credentials here, and the service accepted them.
 * - `unusable`: no credentials here, or the service refused them for good
 *   (revoked, not on the tester list).
 * - `unknown`: this build can't tell (the service's real path isn't built or
 *   is switched off, or the check couldn't reach the service).
 */
export type LocalConnection = 'usable' | 'unusable' | 'unknown';

export interface ReconcilePlan {
  /**
   * Rows to delete: the phone has nothing usable behind them. Deleting a row
   * that isn't there changes nothing, so the rows needn't be read first.
   */
  remove: MusicProvider[];
  /** Rows to write (or refresh `last_verified_at` on): just checked and usable. */
  record: MusicProvider[];
}

/**
 * Decides what to change. Pure, so every case is testable. An `unknown`
 * service is never touched, in either direction: a row made on a build with
 * the real path stays, and nothing is claimed that wasn't checked.
 */
export function reconcileConnections(
  local: Partial<Record<MusicProvider, LocalConnection>>,
): ReconcilePlan {
  const providers = (Object.keys(local) as MusicProvider[]).sort();
  return {
    remove: providers.filter((provider) => local[provider] === 'unusable'),
    record: providers.filter((provider) => local[provider] === 'usable'),
  };
}
