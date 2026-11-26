import type { EnqueueResult } from './roomStore';

/**
 * Shared shapes of the room hooks, so mock mode (the mock store) and live
 * mode (Supabase through TanStack Query) hand the screens the same thing.
 */

/** Whether the room a screen asked for can be shown yet. Mock rooms are always `ready`. */
export type RoomStatus =
  /** Still reading the room from the server. */
  | 'loading'
  | 'ready'
  /** No room with that code among the rooms you're in (or it was never one). */
  | 'missing'
  /** The read failed (offline, or the server refused). TanStack Query retries. */
  | 'error';

/**
 * What adding a song answers: added (`EnqueueResult`), `already_in_queue`
 * (ask first), or a failure with copy to show.
 */
export type AddOutcome =
  | EnqueueResult
  | {
      ok: false;
      error: 'failed';
      /** Plain words for the person, never a raw error. */
      message: string;
    };
