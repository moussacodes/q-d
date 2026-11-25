import { z } from 'zod';

/**
 * Runtime environment validation (docs/ARCHITECTURE.md §4.7 and §8).
 *
 * Every variable here is named `EXPO_PUBLIC_*`, so Expo inlines it into the
 * app bundle: anyone with the app can read it. Only public values belong
 * here (the Supabase project URL and its publishable key). Server secrets,
 * such as a Supabase secret or service-role key, an Apple signing key or a
 * Spotify client secret, live in Edge Function secrets and never in the app.
 *
 * Nothing is required: with no `.env` at all, the app runs in mock mode.
 * A missing or invalid value never crashes the app. It's reported in
 * `problems` (by variable name only, never by value) and that part of the
 * config falls back to its safe default.
 */

/** Variable names. `.env.example` lists exactly these, with no values. */
export const envNames = {
  dataMode: 'EXPO_PUBLIC_DATA_MODE',
  supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
  supabaseKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  spotifyClientId: 'EXPO_PUBLIC_SPOTIFY_CLIENT_ID',
  flagRealAppleMusic: 'EXPO_PUBLIC_FLAG_REAL_APPLE_MUSIC',
  flagRealSpotify: 'EXPO_PUBLIC_FLAG_REAL_SPOTIFY',
  flagSync: 'EXPO_PUBLIC_FLAG_SYNC',
  flagPlaylistImport: 'EXPO_PUBLIC_FLAG_PLAYLIST_IMPORT',
  flagModeration: 'EXPO_PUBLIC_FLAG_MODERATION',
  flagAnalytics: 'EXPO_PUBLIC_FLAG_ANALYTICS',
} as const;

export type EnvName = (typeof envNames)[keyof typeof envNames];
export type RawEnv = Partial<Record<EnvName, string | undefined>>;

/**
 * Reads the variables. Expo only inlines `process.env.EXPO_PUBLIC_*` when
 * each one is written out like this, so the list can't be built in a loop.
 */
export function readRawEnv(): RawEnv {
  return {
    EXPO_PUBLIC_DATA_MODE: process.env.EXPO_PUBLIC_DATA_MODE,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_SPOTIFY_CLIENT_ID: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID,
    EXPO_PUBLIC_FLAG_REAL_APPLE_MUSIC: process.env.EXPO_PUBLIC_FLAG_REAL_APPLE_MUSIC,
    EXPO_PUBLIC_FLAG_REAL_SPOTIFY: process.env.EXPO_PUBLIC_FLAG_REAL_SPOTIFY,
    EXPO_PUBLIC_FLAG_SYNC: process.env.EXPO_PUBLIC_FLAG_SYNC,
    EXPO_PUBLIC_FLAG_PLAYLIST_IMPORT: process.env.EXPO_PUBLIC_FLAG_PLAYLIST_IMPORT,
    EXPO_PUBLIC_FLAG_MODERATION: process.env.EXPO_PUBLIC_FLAG_MODERATION,
    EXPO_PUBLIC_FLAG_ANALYTICS: process.env.EXPO_PUBLIC_FLAG_ANALYTICS,
  };
}

/** An unset variable and an empty one (`NAME=` in `.env`) mean the same thing. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema.optional());

const dataModeSchema = optional(z.enum(['mock', 'live']));

const supabaseUrlSchema = optional(
  z.url({ protocol: /^https?$/ }).refine((url) => !/^[a-z]+:\/\/[^/?#]*@/i.test(url), {
    message: 'must not contain credentials',
  }),
);

/**
 * The key a client may hold: a publishable key (`sb_publishable_…`) or a
 * legacy `anon` JWT. Secret and service-role keys bypass row-level security,
 * so they're rejected even though they'd "work".
 */
const supabaseKeySchema = optional(
  z.string().superRefine((key, ctx) => {
    if (key.startsWith('sb_secret_')) {
      ctx.addIssue({ code: 'custom', message: 'is a secret key; use the publishable key' });
      return;
    }
    if (key.startsWith('sb_publishable_')) {
      if (key.length <= 'sb_publishable_'.length) {
        ctx.addIssue({ code: 'custom', message: 'is incomplete' });
      }
      return;
    }
    const role = jwtRole(key);
    if (role === undefined) {
      ctx.addIssue({ code: 'custom', message: 'is not a Supabase publishable or anon key' });
    } else if (role !== 'anon') {
      ctx.addIssue({ code: 'custom', message: `has role "${role}"; only the anon key is public` });
    }
  }),
);

/**
 * A Spotify client ID: 32 hexadecimal characters. It's public by design
 * (Authorization Code with PKCE has no client secret), so it may ship in the
 * app. A client secret never does.
 */
const spotifyClientIdSchema = optional(
  z.string().regex(/^[0-9a-f]{32}$/i, { message: 'is not a Spotify client ID' }),
);

/** Flags accept true/false, 1/0, on/off and yes/no, in any case. */
const flagSchema = optional(
  z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false', '1', '0', 'on', 'off', 'yes', 'no']))
    .transform((value) => ['true', '1', 'on', 'yes'].includes(value)),
);

/** The `role` claim of a JWT, or undefined if `token` isn't a readable JWT. */
function jwtRole(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (payload && typeof payload === 'object' && 'role' in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === 'string' ? role : undefined;
    }
  } catch {
    // Not base64 or not JSON: not a JWT.
  }
  return undefined;
}

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

export interface RequestedFlags {
  realAppleMusic: boolean;
  realSpotify: boolean;
  sync: boolean;
  playlistImport: boolean;
  moderation: boolean;
  analytics: boolean;
}

export interface AppEnv {
  /** What `EXPO_PUBLIC_DATA_MODE` asked for. `dataMode.ts` decides what runs. */
  requestedDataMode: 'mock' | 'live';
  /** Present only when both Supabase variables are set and valid. */
  supabase: SupabaseEnv | null;
  /** The Spotify app's client ID, or null when it isn't set or isn't valid. */
  spotifyClientId: string | null;
  /** Flags as the environment set them. `flags.ts` applies what this build allows. */
  requestedFlags: RequestedFlags;
}

export interface EnvResult {
  env: AppEnv;
  /** Human-readable problems. They name variables, never their values. */
  problems: string[];
}

const flagKeys: Record<keyof RequestedFlags, EnvName> = {
  realAppleMusic: envNames.flagRealAppleMusic,
  realSpotify: envNames.flagRealSpotify,
  sync: envNames.flagSync,
  playlistImport: envNames.flagPlaylistImport,
  moderation: envNames.flagModeration,
  analytics: envNames.flagAnalytics,
};

/**
 * Validates raw variables. Pure: it never reads `process.env`, logs or throws,
 * so every case can be tested.
 */
export function parseEnv(raw: RawEnv): EnvResult {
  const problems: string[] = [];

  const field = <T>(name: EnvName, schema: z.ZodType<T>, fallback: T): T => {
    const result = schema.safeParse(raw[name]);
    if (result.success) {
      return result.data === undefined ? fallback : result.data;
    }
    const why = result.error.issues[0]?.message ?? 'is invalid';
    problems.push(`${name} ${why.startsWith('Invalid') ? 'is invalid' : why}. It was ignored.`);
    return fallback;
  };

  const requestedDataMode = field(envNames.dataMode, dataModeSchema, 'mock' as const) ?? 'mock';
  const url = field(envNames.supabaseUrl, supabaseUrlSchema, undefined);
  const publishableKey = field(envNames.supabaseKey, supabaseKeySchema, undefined);

  let supabase: SupabaseEnv | null = null;
  if (url && publishableKey) {
    supabase = { url: url.replace(/\/+$/, ''), publishableKey };
  } else if (url || publishableKey) {
    const missing = url ? envNames.supabaseKey : envNames.supabaseUrl;
    problems.push(`${missing} is missing or invalid, so Supabase is off.`);
  }

  const spotifyClientId = field(envNames.spotifyClientId, spotifyClientIdSchema, undefined) ?? null;

  const requestedFlags = Object.fromEntries(
    Object.entries(flagKeys).map(([flag, name]) => [flag, field(name, flagSchema, false) ?? false]),
  ) as unknown as RequestedFlags;

  return { env: { requestedDataMode, supabase, spotifyClientId, requestedFlags }, problems };
}

/** The validated environment for this run of the app. */
export const envResult: EnvResult = parseEnv(readRawEnv());

export const env: AppEnv = envResult.env;
