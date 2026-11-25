/**
 * Redaction for everything that leaves the app as text: logs, crash reports
 * and, later, analytics (docs/PRODUCT_SPEC.md §7, ARCHITECTURE.md §4.7).
 *
 * It removes:
 * - credentials: tokens, keys, passwords, cookies, `Authorization` headers,
 *   JWTs, Supabase keys and long random strings that look like tokens;
 * - emails;
 * - room codes (`QD-7K4F9X`) and QR invite tokens;
 * - listening history: song titles, artists, albums, ISRCs, track and
 *   playlist ids, provider links, queues and search queries;
 * - display names and phone numbers.
 *
 * Two layers work together. Values under a sensitive key are replaced whole,
 * whatever their type (so `{ track: { title, artist } }` becomes
 * `{ track: '[redacted]' }`). Every other string is scanned for patterns
 * (emails, codes, tokens, provider ids), which catches them inside free text
 * and error messages.
 *
 * Free text can't be scanned for song titles: "Rain Down" looks like any
 * other words. So log messages are fixed strings, and song data goes in the
 * context object, under keys like `title`, where it's removed.
 */

export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;
const SCAN_LIMIT = 10_000;

/** Lowercased, without `_`, `-` or spaces: `access_token` → `accesstoken`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A key containing any of these is sensitive. */
const SENSITIVE_KEY_PARTS = [
  // Credentials
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'authorization',
  'cookie',
  'credential',
  'session',
  'jwt',
  'bearer',
  'apikey',
  'privatekey',
  'signingkey',
  'publishablekey',
  'anonkey',
  'servicerole',
  'otp',
  // Emails and people
  'email',
  'phone',
  'displayname',
  'fullname',
  'username',
  // Room codes and invites
  'roomcode',
  'joincode',
  'invite',
  // Listening history
  'artist',
  'album',
  'isrc',
  'track',
  'song',
  'recording',
  'playlist',
  'queue',
  'history',
  'nowplaying',
  'lyric',
  'artwork',
  'catalogid',
  'searchquery',
  'searchterm',
];

/** Keys that are sensitive only as a whole word (`code`, but not `errorCode`). */
const SENSITIVE_EXACT_KEYS = new Set([
  'code',
  'title',
  'query',
  'q',
  'term',
  'uri',
  'url',
  'href',
  'link',
  'deeplink',
  'auth',
  'key',
  'name',
  'user',
  'body',
  'headers',
  'params',
]);

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_EXACT_KEYS.has(normalized) ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

/** Patterns replaced inside any string. Order matters: specific before general. */
const STRING_RULES: readonly [RegExp, string][] = [
  // Bearer and Basic credentials, e.g. an Authorization header copied into a message.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]'],
  // Sensitive query and fragment parameters, e.g. qd://join?invite=… or #access_token=…
  [
    /([?&#;](?:access_token|refresh_token|id_token|provider_token|token|invite|code|key|apikey|api_key|password|email|state|otp)=)[^&#\s"']*/gi,
    '$1[redacted]',
  ],
  // Postgres constraint details, e.g. `Key (code)=(7K4F9X) already exists`.
  [/\bKey \(([^()]*)\)=\((?:[^()]|\([^()]*\))*\)/g, 'Key ($1)=([redacted])'],
  // JWTs (header.payload.signature, header starts with eyJ).
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, '[token]'],
  // Supabase API keys.
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]*/g, '[token]'],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Room codes: QD-7K4F9X, qd 7k4f9x, QD7K4F9X.
  [/\bQD[-\s]?[A-Za-z0-9]{6}\b/gi, '[room-code]'],
  // Provider links and ids.
  [/\bspotify:[a-z]+:[A-Za-z0-9]+/gi, '[music-id]'],
  [
    /\b(?:https?:\/\/)?(?:open\.spotify\.com|music\.apple\.com|itunes\.apple\.com)\/[^\s"'<>]*/gi,
    '[music-link]',
  ],
  // ISRCs: CC-XXX-YY-NNNNN, with or without hyphens.
  [/\b[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}\b/g, '[music-id]'],
];

/**
 * Long random-looking strings: invite tokens (at least 128-bit, URL-safe),
 * provider ids and access tokens. A run of 20+ URL-safe characters that mixes
 * upper case, lower case and digits. UUIDs (lower-case hex) and ordinary
 * words don't match.
 */
const OPAQUE_RUN = /[A-Za-z0-9_-]{20,}/g;

function looksRandom(run: string): boolean {
  return /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
}

/** Redacts sensitive patterns inside one string. */
export function redactString(input: string): string {
  // Redact first and shorten after, so a second pass changes nothing.
  // The scan itself stops at SCAN_LIMIT characters, far past what's kept.
  let output = input.length > SCAN_LIMIT ? input.slice(0, SCAN_LIMIT) : input;
  for (const [pattern, replacement] of STRING_RULES) {
    output = output.replace(pattern, replacement);
  }
  output = output.replace(OPAQUE_RUN, (run) => (looksRandom(run) ? '[token]' : run));
  return output.length > MAX_STRING_LENGTH ? `${output.slice(0, MAX_STRING_LENGTH - 1)}…` : output;
}

export interface RedactedError {
  name: string;
  message: string;
  code?: string | number;
  stack?: string;
  cause?: unknown;
  [key: string]: unknown;
}

/** Fields of an error that are safe to keep once their strings are redacted. */
const ERROR_FIELDS = new Set(['name', 'message', 'stack', 'cause', 'code']);

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
    case 'boolean':
    case 'undefined':
      return value;
    case 'bigint':
      return value.toString();
    case 'symbol':
      return value.toString();
    case 'function':
      return '[function]';
  }
  if (value === null) return null;

  const object = value as object;
  if (seen.has(object)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(object);
  try {
    if (object instanceof Error) return redactErrorInner(object, depth, seen);
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString();
    }
    if (object instanceof RegExp) return redactString(object.toString());
    if (Array.isArray(object)) {
      const items = object
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactInner(item, depth + 1, seen));
      if (object.length > MAX_ARRAY_ITEMS) items.push(`[${object.length - MAX_ARRAY_ITEMS} more]`);
      return items;
    }
    if (object instanceof Map) {
      return redactEntries(
        Array.from(object.entries()).map(([key, item]) => [String(key), item]),
        depth,
        seen,
      );
    }
    if (object instanceof Set) {
      return redactInner(Array.from(object), depth, seen);
    }
    return redactEntries(Object.entries(object), depth, seen);
  } finally {
    seen.delete(object);
  }
}

function redactEntries(
  entries: [string, unknown][],
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    const safeKey = redactString(key);
    output[safeKey] = isSensitiveKey(key) ? REDACTED : redactInner(item, depth + 1, seen);
  }
  return output;
}

function redactErrorInner(error: Error, depth: number, seen: WeakSet<object>): RedactedError {
  const output: RedactedError = {
    name: redactString(error.name || 'Error'),
    message: redactString(error.message ?? ''),
  };
  const { code, cause } = error as Error & { code?: unknown; cause?: unknown };
  if (typeof code === 'string' || typeof code === 'number') {
    output.code = typeof code === 'string' ? redactString(code) : code;
  }
  if (typeof error.stack === 'string') output.stack = redactString(error.stack);
  if (cause !== undefined) output.cause = redactInner(cause, depth + 1, seen);
  // Extra fields some libraries add (Supabase's `details` and `hint`, a
  // provider's `status`), under the same key rules as any object.
  for (const [key, item] of Object.entries(error)) {
    if (ERROR_FIELDS.has(key)) continue;
    output[redactString(key)] = isSensitiveKey(key) ? REDACTED : redactInner(item, depth + 1, seen);
  }
  return output;
}

/** Redacts any value: strings, nested objects, arrays, Maps, Sets and Errors. */
export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

/** Redacts an error, or anything thrown in its place. */
export function redactError(error: unknown): RedactedError {
  if (error instanceof Error || isErrorLike(error)) {
    const seen = new WeakSet<object>([error]);
    return redactErrorInner(error, 0, seen);
  }
  return { name: 'NonError', message: redactString(safeString(error)) };
}

/**
 * An object shaped like an error: a serialized one, an already-redacted
 * one, or a library's plain error object (`{ message, code, details }`).
 */
function isErrorLike(value: unknown): value is Error {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { message?: unknown }).message === 'string' &&
    ['undefined', 'string'].includes(typeof (value as { name?: unknown }).name)
  );
}

/** Redacts a context object. Anything that isn't a plain object is wrapped as `{ value }`. */
export function redactContext(context: unknown): Record<string, unknown> {
  const redacted = redact(context);
  if (redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return { value: redacted };
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(redact(value));
    return json === undefined ? String(value) : json;
  } catch {
    return Object.prototype.toString.call(value);
  }
}
