import { addLogSink, type LogEntry } from './logger';
import { redact, redactContext, redactError, redactString, type RedactedError } from './redact';

/**
 * Privacy-filtered crash reporting (docs/PRODUCT_SPEC.md §7).
 *
 * There's no crash-reporting service yet, so nothing leaves the device until
 * a transport is set with `setCrashTransport`. Whatever service is chosen
 * later, every event goes through `beforeSend` first. It keeps only an
 * allowlist of fields and redacts each of them, so user details, request
 * bodies, headers, device ids, screenshots and replays never get through.
 *
 * Reports are never automatic beyond crashes: no session replay, no
 * automatic breadcrumbs (taps, navigation, network, console) and no
 * automatic event capture. Breadcrumbs exist only when code adds them.
 */

export type CrashLevel = 'error' | 'fatal';

export interface Breadcrumb {
  message: string;
  time: string;
  data?: Record<string, unknown>;
}

export interface CrashEvent {
  level: CrashLevel;
  message: string;
  time: string;
  error?: RedactedError;
  context?: Record<string, unknown>;
  tags?: Record<string, string>;
  breadcrumbs?: Breadcrumb[];
}

export type CrashTransport = (event: CrashEvent) => void | Promise<void>;

/**
 * Settings any crash-reporting SDK must use if one is added. They're the
 * product rules, written down where the integration will look.
 */
export const crashReportingPolicy = Object.freeze({
  sessionReplay: false,
  automaticBreadcrumbs: false,
  automaticEventCapture: false,
  sendDefaultPii: false,
  attachScreenshot: false,
  attachViewHierarchy: false,
});

/** Tags that may be sent, as non-identifying strings of at most 64 characters. */
export const allowedTags: readonly string[] = [
  'platform',
  'os',
  'osVersion',
  'appVersion',
  'release',
  'dataMode',
  'screen',
];

const MAX_BREADCRUMBS = 20;
const MAX_TAG_LENGTH = 64;

/**
 * Turns any event-like object into a safe `CrashEvent`, or `null` if there's
 * nothing worth sending. Unknown fields are dropped, not redacted, so a field
 * a future SDK adds can't leak by default.
 */
export function beforeSend(event: unknown): CrashEvent | null {
  if (event === null || typeof event !== 'object') return null;
  const raw = event as Record<string, unknown>;

  const error = raw.error !== undefined ? redactError(raw.error) : undefined;
  const message =
    typeof raw.message === 'string' && raw.message !== ''
      ? redactString(raw.message)
      : (error?.message ?? '');
  if (!message && !error) return null;

  const safe: CrashEvent = {
    level: raw.level === 'fatal' ? 'fatal' : 'error',
    message,
    time: typeof raw.time === 'string' ? redactString(raw.time) : new Date().toISOString(),
  };
  if (error) safe.error = error;
  if (raw.context !== undefined) safe.context = redactContext(raw.context);

  const tags = filterTags(raw.tags);
  if (tags) safe.tags = tags;

  if (Array.isArray(raw.breadcrumbs)) {
    const breadcrumbs = raw.breadcrumbs
      .slice(-MAX_BREADCRUMBS)
      .map(filterBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
    if (breadcrumbs.length > 0) safe.breadcrumbs = breadcrumbs;
  }
  return safe;
}

function filterTags(tags: unknown): Record<string, string> | undefined {
  if (tags === null || typeof tags !== 'object') return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!allowedTags.includes(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      continue;
    }
    output[key] = redactString(String(value)).slice(0, MAX_TAG_LENGTH);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function filterBreadcrumb(crumb: unknown): Breadcrumb | null {
  if (crumb === null || typeof crumb !== 'object') return null;
  const raw = crumb as Record<string, unknown>;
  if (typeof raw.message !== 'string') return null;
  const output: Breadcrumb = {
    message: redactString(raw.message),
    time: typeof raw.time === 'string' ? redactString(raw.time) : '',
  };
  if (raw.data !== undefined) output.data = redactContext(raw.data);
  return output;
}

let transport: CrashTransport | null = null;
let removeLogSink: (() => void) | null = null;
let breadcrumbs: Breadcrumb[] = [];

interface PendingEvent {
  level: CrashLevel;
  message: string;
  time?: string;
  /** An Error, anything thrown, or an already-redacted error. `beforeSend` redacts it. */
  error?: unknown;
  context?: Record<string, unknown>;
}

function send(event: PendingEvent): void {
  if (!transport) return;
  const safe = beforeSend({ ...event, breadcrumbs });
  if (!safe) return;
  try {
    const pending = transport(safe);
    if (pending && typeof pending.catch === 'function') {
      pending.catch(() => {
        // A failed upload is dropped. Retrying could resend after sign-out.
      });
    }
  } catch {
    // The reporter must never crash the app it reports on.
  }
}

/** Errors logged with `log.error` become crash events while a transport is set. */
function reportLogEntry(entry: LogEntry): void {
  if (entry.level !== 'error') return;
  send({
    level: 'error',
    message: entry.scope ? `[${entry.scope}] ${entry.message}` : entry.message,
    time: entry.time,
    error: entry.error,
    context: entry.context,
  });
}

/**
 * Sets where reports go, or `null` to stop sending. Until this is called,
 * nothing is sent anywhere.
 */
export function setCrashTransport(next: CrashTransport | null): void {
  transport = next;
  removeLogSink?.();
  removeLogSink = next ? addLogSink(reportLogEntry) : null;
  if (!next) breadcrumbs = [];
}

/** Reports a caught error. Does nothing without a transport. */
export function captureException(error: unknown, context?: object, level: CrashLevel = 'error') {
  send({ level, message: '', error, context: context as Record<string, unknown> | undefined });
}

/**
 * Records a step to send with the next report, e.g. `addBreadcrumb('Opened
 * room')`. Only code adds breadcrumbs; nothing is recorded automatically.
 */
export function addBreadcrumb(message: string, data?: object): void {
  if (!transport) return;
  const crumb: Breadcrumb = { message: redactString(message), time: new Date().toISOString() };
  if (data !== undefined) crumb.data = redact(data) as Record<string, unknown>;
  breadcrumbs = [...breadcrumbs, crumb].slice(-MAX_BREADCRUMBS);
}

/** Forgets breadcrumbs, e.g. on sign-out. */
export function clearBreadcrumbs(): void {
  breadcrumbs = [];
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

/**
 * Reports uncaught JavaScript errors, then hands them to React Native's own
 * handler (the red screen in development). Returns a function that restores
 * the previous handler.
 */
export function installGlobalErrorHandler(
  errorUtils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike })
    .ErrorUtils,
): () => void {
  if (!errorUtils) return () => {};
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    captureException(error, { fatal: isFatal === true }, isFatal ? 'fatal' : 'error');
    previous(error, isFatal);
  });
  return () => errorUtils.setGlobalHandler(previous);
}
