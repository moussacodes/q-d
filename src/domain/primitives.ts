import { z } from 'zod';

/**
 * Building blocks for the domain schemas (docs/API_CONTRACTS.md §1): IDs are
 * UUIDs, times are ISO 8601 timestamps from the server clock, and durations and
 * positions are integer milliseconds.
 */

export const idSchema = z.uuid();

/** A server timestamp. Postgres `timestamptz` serializes with an offset (`+00:00`) or `Z`. */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Whole milliseconds, never negative. */
export const millisecondsSchema = z.int().nonnegative();

/** An International Standard Recording Code, stored in its compact uppercase form. */
export const isrcSchema = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/, 'Invalid ISRC');

/** A short version marker such as `live` or `sped_up`. Lowercase snake case. */
export const versionTagSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Invalid version tag');
