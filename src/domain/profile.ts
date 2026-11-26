/**
 * The onboarding profile rules (PRODUCT_SPEC.md § 3, "Your name"): a display
 * name, an avatar color and an 18+ confirmation. They match the `profiles`
 * table's checks (supabase/migrations/20261124000100_initial_schema.sql), so
 * the app refuses what the database would refuse, with its own words.
 *
 * The swatch list is passed in: it belongs to the design tokens
 * (`avatarSwatches` in src/design), which domain code doesn't import.
 */

/** The longest display name, in characters (Postgres `char_length`). */
export const MAX_DISPLAY_NAME_LENGTH = 30;

export type DisplayNameError = 'name_missing' | 'name_too_long' | 'name_invalid';
export type ProfileFieldError = DisplayNameError | 'color_invalid' | 'adult_required';

/** Characters, not UTF-16 units, like Postgres's `char_length` (an emoji is one). */
export function displayNameLength(name: string): number {
  return [...name].length;
}

// Control characters (newlines, tabs, NUL…) can't be typed into the field
// and would break "Added by …" lines, so a pasted one is refused.
const CONTROL = /\p{Cc}/u;

/** The name as it's saved: trimmed. */
export function normalizeDisplayName(name: string): string {
  return name.trim();
}

/** Why a display name can't be saved, or null when it can. Checks the trimmed name. */
export function displayNameError(name: string): DisplayNameError | null {
  const trimmed = normalizeDisplayName(name);
  if (!trimmed) return 'name_missing';
  if (displayNameLength(trimmed) > MAX_DISPLAY_NAME_LENGTH) return 'name_too_long';
  if (CONTROL.test(trimmed)) return 'name_invalid';
  return null;
}

/** True when `color` is one of the swatches onboarding and Settings offer. */
export function isAvatarSwatch(color: string, swatches: readonly string[]): boolean {
  return swatches.some((swatch) => swatch.toLowerCase() === color.toLowerCase());
}

export interface OnboardingProfileInput {
  displayName: string;
  color: string;
  adultConfirmed: boolean;
}

/** What onboarding step 1 writes to the caller's own `profiles` row. */
export interface OnboardingProfile {
  displayName: string;
  color: string;
}

export type ProfileValidation<T> = { ok: true; value: T } | { ok: false; error: ProfileFieldError };

/** Onboarding step 1: all three are required (PRODUCT_SPEC.md § 3). */
export function validateOnboardingProfile(
  input: OnboardingProfileInput,
  swatches: readonly string[],
): ProfileValidation<OnboardingProfile> {
  const nameError = displayNameError(input.displayName);
  if (nameError) return { ok: false, error: nameError };
  if (!isAvatarSwatch(input.color, swatches)) return { ok: false, error: 'color_invalid' };
  if (!input.adultConfirmed) return { ok: false, error: 'adult_required' };
  return {
    ok: true,
    value: { displayName: normalizeDisplayName(input.displayName), color: input.color },
  };
}

/** A Settings change: the name, the color, or both. The 18+ confirmation stays as saved. */
export type ProfileChange = { displayName?: string; color?: string };

export function validateProfileChange(
  change: ProfileChange,
  swatches: readonly string[],
): ProfileValidation<ProfileChange> {
  const value: ProfileChange = {};
  if (change.displayName !== undefined) {
    const nameError = displayNameError(change.displayName);
    if (nameError) return { ok: false, error: nameError };
    value.displayName = normalizeDisplayName(change.displayName);
  }
  if (change.color !== undefined) {
    if (!isAvatarSwatch(change.color, swatches)) return { ok: false, error: 'color_invalid' };
    value.color = change.color;
  }
  return { ok: true, value };
}
