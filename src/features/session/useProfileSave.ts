import { useCallback, useRef, useState } from 'react';

import { avatarSwatches } from '@/design';
import {
  validateOnboardingProfile,
  validateProfileChange,
  type OnboardingProfileInput,
  type ProfileChange,
  type ProfileFieldError,
} from '@/domain/profile';
import { isLiveAuth } from '@/services/dataMode';
import { saveOnboardingProfile, updateProfile, type ProfileWriteError } from '@/services/profiles';

import { useMockSession } from './MockSession';

/** Why a profile save didn't happen: the app refused it, or the server did. */
export type ProfileSaveError = ProfileFieldError | ProfileWriteError;

/** Words for each failure. A failed save always says nothing was changed. */
export const profileSaveCopy: Record<ProfileSaveError, string> = {
  name_missing: 'Add a display name.',
  name_too_long: 'Use 30 characters or fewer.',
  name_invalid: 'Take out line breaks and tabs from your name.',
  color_invalid: 'Pick one of the colors.',
  adult_required: 'Confirm you’re 18 or older to use q’d.',
  network: 'Couldn’t reach q’d, so nothing was saved. Check your connection and try again.',
  not_signed_in: 'You’ve been signed out. Sign in again to save your profile.',
  rejected: 'q’d couldn’t save that. Check your name and color, then try again.',
  not_configured: 'This build can’t save profiles. Nothing was saved.',
  unknown: 'Something went wrong, so nothing was saved. Try again.',
};

const swatches: readonly string[] = avatarSwatches;

/**
 * Saves the profile onboarding step 1 and Settings collect.
 *
 * Mock auth mode keeps it in the session only, as before. Live auth mode
 * writes the signed-in person's own `profiles` row first
 * (services/profiles.ts) and updates the session only when the write
 * succeeded, so the screen never shows a name or color the server doesn't
 * have. Both check the rules in domain/profile.ts first.
 */
export function useProfileSave(options: { live?: boolean } = {}) {
  const { live = isLiveAuth } = options;
  const { user, liveUserId, saveProfile } = useMockSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ProfileSaveError | null>(null);
  // One write at a time: a second tap while saving sends nothing.
  const busy = useRef(false);

  const run = useCallback(
    async (write: () => Promise<{ ok: true } | { ok: false; error: ProfileWriteError }>) => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      setError(null);
      try {
        const result = await write();
        if (!result.ok) setError(result.error);
        return result.ok;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [],
  );

  /** Onboarding step 1. Resolves true once saved; the screen moves on only then. */
  const saveOnboarding = useCallback(
    async (input: OnboardingProfileInput): Promise<boolean> => {
      const checked = validateOnboardingProfile(input, swatches);
      if (!checked.ok) {
        setError(checked.error);
        return false;
      }
      const profile = { name: checked.value.displayName, color: checked.value.color };
      if (!live) {
        setError(null);
        saveProfile(profile);
        return true;
      }
      if (!liveUserId) {
        setError('not_signed_in');
        return false;
      }
      const ok = await run(() => saveOnboardingProfile(liveUserId, checked.value));
      if (ok) saveProfile(profile);
      return ok;
    },
    [live, liveUserId, run, saveProfile],
  );

  /** Settings: a new name or color. Resolves true once saved. */
  const saveChange = useCallback(
    async (change: ProfileChange): Promise<boolean> => {
      const checked = validateProfileChange(change, swatches);
      if (!checked.ok) {
        setError(checked.error);
        return false;
      }
      const next = {
        name: checked.value.displayName ?? user.name,
        color: checked.value.color ?? user.color,
      };
      if (!live) {
        setError(null);
        saveProfile(next);
        return true;
      }
      if (!liveUserId) {
        setError('not_signed_in');
        return false;
      }
      const ok = await run(() => updateProfile(liveUserId, checked.value));
      if (ok) saveProfile(next);
      return ok;
    },
    [live, liveUserId, run, saveProfile, user.name, user.color],
  );

  return {
    /** True in live auth mode, where saving waits for the server. */
    live,
    saving,
    error,
    errorMessage: error ? profileSaveCopy[error] : null,
    clearError: useCallback(() => setError(null), []),
    saveOnboarding,
    saveChange,
  };
}
