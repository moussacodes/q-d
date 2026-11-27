import type { OverrideChoice, OverrideResult, RoomRef, RoomStore } from './roomStore';

/**
 * Mock mode's `override_track_match` call (API_CONTRACTS.md § override_track_match).
 * It answers asynchronously, like the RPC, so the sheet's saving and error
 * states are real. The Supabase card swaps the body for `supabase.rpc`.
 */
export const overrideTrackMatchRpc = {
  async call(
    store: RoomStore,
    ref: RoomRef,
    choice: OverrideChoice,
    createdBy: string,
  ): Promise<OverrideResult> {
    return store.overrideMatch(ref, choice, createdBy);
  },
};
