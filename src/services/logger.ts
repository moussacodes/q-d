import { redactContext, redactError, redactString, type RedactedError } from './redact';

/**
 * Structured logging (docs/ARCHITECTURE.md §4.7). Every entry is redacted
 * before any sink sees it, so no sink can leak a token, email, room code or
 * listening history (see redact.ts).
 *
 * Write messages as fixed strings and put data in the context:
 *
 *   log.warn('Enqueue failed', { error, roomId, attempt });
 *
 * not `log.warn(\`Couldn't add ${title}\`)`, because a song title in free
 * text can't be recognized and removed.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** ISO 8601. */
  time: string;
  /** Which part of the app wrote it, e.g. `env` or `room`. */
  scope?: string;
  context?: Record<string, unknown>;
  error?: RedactedError;
}

/** Receives redacted entries only. */
export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, context?: object): void;
  info(message: string, context?: object): void;
  warn(message: string, context?: object): void;
  /** `error` may be an Error or anything thrown. */
  error(message: string, error?: unknown, context?: object): void;
  /** A logger whose entries carry `scope`, sharing this one's sinks and level. */
  child(scope: string): Logger;
}

export interface LoggerOptions {
  scope?: string;
  /** Entries below this level are dropped. */
  minLevel?: LogLevel;
  sinks?: LogSink[];
  now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const { scope, minLevel = 'debug', sinks = [], now = () => new Date() } = options;

  const write = (level: LogLevel, message: string, error: unknown, context?: object) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const entry: LogEntry = {
      level,
      message: redactString(String(message)),
      time: now().toISOString(),
    };
    if (scope) entry.scope = redactString(scope);
    if (context !== undefined) entry.context = redactContext(context);
    if (error !== undefined) entry.error = redactError(error);
    for (const sink of sinks) {
      try {
        sink(entry);
      } catch {
        // A broken sink must never break the app or the other sinks.
      }
    }
  };

  return {
    debug: (message, context) => write('debug', message, undefined, context),
    info: (message, context) => write('info', message, undefined, context),
    warn: (message, context) => write('warn', message, undefined, context),
    error: (message, error, context) => write('error', message, error, context),
    child: (childScope) =>
      createLogger({
        ...options,
        scope: scope ? `${scope}.${childScope}` : childScope,
      }),
  };
}

type ConsoleLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

/** Prints entries to the console as `[scope] message`, followed by any data. */
export function consoleSink(target: ConsoleLike = console): LogSink {
  return (entry) => {
    const text = entry.scope ? `[${entry.scope}] ${entry.message}` : entry.message;
    const data: Record<string, unknown> = { ...entry.context };
    if (entry.error) data.error = entry.error;
    const args: unknown[] = Object.keys(data).length > 0 ? [text, data] : [text];
    target[entry.level](...args);
  };
}

/**
 * Extra sinks, e.g. the crash reporter. Kept separate from the console sink
 * so `crashReporting.ts` can register without an import cycle.
 */
const extraSinks = new Set<LogSink>();

/** Adds a sink to the app logger. Returns a function that removes it. */
export function addLogSink(sink: LogSink): () => void {
  extraSinks.add(sink);
  return () => extraSinks.delete(sink);
}

const appConsoleSink = consoleSink();

/**
 * The app's logger. Development builds print everything from `debug` up.
 * Release builds print only warnings and errors. Nothing is sent anywhere
 * else unless a sink is added (the crash reporter adds one when it has a
 * transport).
 */
export const log: Logger = createLogger({
  minLevel: __DEV__ ? 'debug' : 'warn',
  sinks: [
    appConsoleSink,
    (entry) => {
      for (const sink of extraSinks) {
        try {
          sink(entry);
        } catch {
          // Same rule as above: one broken sink doesn't stop the others.
        }
      }
    },
  ],
});
