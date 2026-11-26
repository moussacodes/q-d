/**
 * Static privacy guard (Forge card "Logs and analytics privacy check").
 *
 * Reads every source file the app, the Edge Functions and the operator
 * scripts ship, parses it with the TypeScript compiler, and checks three rules
 * that the runtime tests (privacyLogs.test.ts, __tests__/privacy-logs.test.tsx)
 * can't see on their own:
 *
 * 1. Nothing writes to `console` except the logger's console sink and the
 *    demo-reset CLI, whose output is counts only.
 * 2. Every log call's message is a fixed string, and no log, crash-report or
 *    breadcrumb call is handed a value whose name says it's sensitive
 *    (tokens, emails, passwords, codes, PKCE verifier and state, room codes,
 *    invite tokens, song titles, artists, ISRCs, search queries, user ids).
 * 3. No analytics client exists yet: nothing writes `analytics_events` and no
 *    analytics or crash-reporting SDK is installed.
 *
 * The allowlists below are reviewed exceptions. Each one says why it's safe.
 * A new exception needs the same: a reason a reviewer can check. An entry
 * that no longer matches anything fails too, so the lists don't go stale.
 *
 * Limits: the guard reads names at the call site only. A value renamed first
 * (`const e = user.email; log.info('x', { e })`) or a logger stored under a
 * name that doesn't end in `log`/`Log`/`logger`/`Logger` isn't seen. The
 * redactor's value scan (emails, codes, tokens, ids) and the runtime canary
 * tests cover those; a song title behind an alias is caught by review only.
 * "The guard itself" below pins what is and isn't caught.
 */
const fs = jest.requireActual<typeof import('fs')>('fs');
const path = jest.requireActual<typeof import('path')>('path');
const ts = jest.requireActual<typeof import('typescript')>('typescript');

const ROOT = process.cwd();
const SCANNED = ['src', 'app', 'supabase/functions', 'supabase/scripts'];
const SOURCE = /\.(ts|tsx|js)$/;

function isScanned(relative: string): boolean {
  return (
    SOURCE.test(relative) &&
    !/\.test\.(ts|tsx|js)$/.test(relative) &&
    !relative.endsWith('.d.ts') &&
    // Test helpers never ship.
    !relative.startsWith('src/test/')
  );
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(relative));
    else if (isScanned(relative)) out.push(relative);
  }
  return out;
}

const files = SCANNED.flatMap(listFiles).sort();

function parse(relative: string) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const kind = relative.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : relative.endsWith('.js')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, kind);
}

function walk(node: import('typescript').Node, visit: (node: import('typescript').Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function lineOf(node: import('typescript').Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// ---------------------------------------------------------------------------
// 1. console

/**
 * Files allowed to touch `console`, and why. Everything else logs through
 * `log` from src/services/logger.ts, which redacts before any sink.
 */
const CONSOLE_ALLOWED: Record<string, string> = {
  // The console sink receives entries the logger has already redacted.
  'src/services/logger.ts': 'consoleSink prints redacted LogEntry values only',
  // An operator CLI run on a laptop; it prints usage text and counts, never
  // an email, id, key or room code (supabase/tests/reset-demo-accounts-script.test.ts).
  'supabase/scripts/reset-demo-accounts.js': 'CLI out/err lines are fixed text and counts',
};

describe('console', () => {
  const uses = new Map<string, number[]>();
  for (const file of files) {
    walk(parse(file), (node) => {
      if (ts.isIdentifier(node) && node.text === 'console') {
        // `console` as a value: console.warn(…), consoleSink(console), globalThis.console.
        // Only an object key named `console` ({ console: … }) isn't a use.
        const parent = node.parent;
        if (!(ts.isPropertyAssignment(parent) && parent.name === node)) {
          uses.set(file, [...(uses.get(file) ?? []), lineOf(node)]);
        }
      }
    });
  }

  it('scans the app, the Edge Functions and the scripts', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/services/logger.ts');
    expect(files).toContain('supabase/functions/catalog-search/handler.ts');
    expect(files).toContain('supabase/scripts/reset-demo-accounts.js');
    expect(files.some((file) => file.startsWith('app/'))).toBe(true);
  });

  it('is used only by the logger and the demo-reset CLI', () => {
    const offenders = [...uses.entries()]
      .filter(([file]) => !(file in CONSOLE_ALLOWED))
      .map(([file, lines]) => `${file}:${lines.join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    expect(Object.keys(CONSOLE_ALLOWED).filter((file) => !uses.has(file))).toEqual([]);
  });

  it('is never used by the Edge Functions (a query is listening intent)', () => {
    expect([...uses.keys()].filter((file) => file.startsWith('supabase/functions/'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. log, crash-report and breadcrumb calls

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/** `log`, `logger`, `authLog`, `deps.log`, `this.logger`, `log.child('x')`… */
const LOGGER_NAME = /^(?:log|logger)$|Log(?:ger)?$/;

function isLoggerExpression(node: import('typescript').Expression): boolean {
  if (ts.isIdentifier(node)) return LOGGER_NAME.test(node.text);
  if (ts.isPropertyAccessExpression(node)) return LOGGER_NAME.test(node.name.text);
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'child'
  ) {
    return isLoggerExpression(node.expression.expression);
  }
  return false;
}

type Call = {
  file: string;
  line: number;
  kind: 'log' | 'report';
  node: import('typescript').CallExpression;
};

const REPORT_CALLS = new Set(['captureException', 'addBreadcrumb']);

/** `addBreadcrumb(…)` and `crash.addBreadcrumb(…)` alike. */
function calleeName(callee: import('typescript').Expression): string {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
}

function callsIn(file: string, source: import('typescript').SourceFile): Call[] {
  const calls: Call[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      LEVELS.has(callee.name.text) &&
      isLoggerExpression(callee.expression)
    ) {
      calls.push({ file, line: lineOf(node), kind: 'log', node });
    } else if (REPORT_CALLS.has(calleeName(callee))) {
      calls.push({ file, line: lineOf(node), kind: 'report', node });
    }
  });
  return calls;
}

function findCalls(): Call[] {
  return files.flatMap((file) => callsIn(file, parse(file)));
}

/**
 * Names that say a value is sensitive, compared lowercased without `_` or `-`.
 * Parts match anywhere in a name; exact names match the whole name only, so
 * `errorCode` and `request.path` stay allowed while `code` and `url` don't.
 */
const SENSITIVE_PARTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'email',
  'verifier',
  'challenge',
  'refresh',
  'roomcode',
  'invite',
  'isrc',
  'title',
  'artist',
  'album',
  'displayname',
  'fullname',
  'query',
  'searchterm',
  'lyric',
  'userid',
  'authorization',
  'cookie',
];
const SENSITIVE_EXACT = new Set(['code', 'state', 'url', 'uri', 'user', 'session', 'name', 'term']);

function isSensitiveName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_EXACT.has(normalized) || SENSITIVE_PARTS.some((part) => normalized.includes(part))
  );
}

/** Every identifier used as a value inside an argument (not object keys). */
function valueNames(node: import('typescript').Node): { name: string; line: number }[] {
  const names: { name: string; line: number }[] = [];
  walk(node, (inner) => {
    if (!ts.isIdentifier(inner)) return;
    const parent = inner.parent;
    if (ts.isPropertyAssignment(parent) && parent.name === inner) return; // { key: value }
    names.push({ name: inner.text, line: lineOf(inner) });
  });
  return names;
}

/**
 * Reviewed exceptions: `file|identifier` → why it's safe.
 */
const SENSITIVE_ALLOWED: Record<string, string> = {
  // `code` is an AuthErrorCode (our own enum), logged as `errorCode`.
  'src/features/auth/useAuthCallback.ts|code':
    'AuthErrorCode from callbackErrorCode/exchange, not the PKCE code',
  // `error.name` is the class name of what the sheet threw (`TypeError`).
  'src/providers/spotify/auth.ts|name': 'error.name is a class name; the message is never logged',
  // tokenErrorCode(body) returns Spotify's OAuth error only if it matches ^[a-z_]{1,40}$.
  'src/providers/spotify/auth.ts|tokenErrorCode': 'returns an OAuth error code, never free text',
  // Boolean(data.session): whether a session exists, never the session.
  'src/services/auth.ts|session': 'Boolean(data.session) logs true/false only',
  // signInMethodOf(data.user): 'email' | 'google' | 'apple'.
  'src/services/auth.ts|user': 'signInMethodOf(data.user) logs the method enum only',
  // error.code on a failed profiles read: a PostgREST/SQLSTATE code.
  'src/services/auth.ts|code': 'PostgREST error code (e.g. PGRST116), not input',
  // query.meta?.scope: a fixed label set in code by whoever wrote the query.
  'src/services/queryClient.ts|query':
    'query.meta.scope is a fixed label; the query key is never logged',
};

/**
 * Log calls whose message isn't a string literal, and why that's safe.
 */
const DYNAMIC_MESSAGE_ALLOWED: Record<string, string> = {
  // Environment problems name variables, never their values (env.ts, flags.ts).
  'src/services/dataMode.ts': 'env problems and fallback reasons name variables only',
  'src/services/flags.ts': 'flag problems name the variable only',
};

function checkCalls(calls: Call[]) {
  const usedSensitive = new Set<string>();
  const usedDynamic = new Set<string>();
  const sensitive: string[] = [];
  const dynamic: string[] = [];

  for (const call of calls) {
    const [message] = call.node.arguments;
    // A log message and a breadcrumb message are both free text nothing can scan for songs.
    const hasMessage = call.kind === 'log' || calleeName(call.node.expression) === 'addBreadcrumb';
    if (
      hasMessage &&
      message !== undefined &&
      !ts.isStringLiteral(message) &&
      !ts.isNoSubstitutionTemplateLiteral(message)
    ) {
      if (call.file in DYNAMIC_MESSAGE_ALLOWED) usedDynamic.add(call.file);
      else dynamic.push(`${call.file}:${call.line}`);
    }
    for (const argument of call.node.arguments) {
      for (const { name, line } of valueNames(argument)) {
        if (!isSensitiveName(name)) continue;
        const key = `${call.file}|${name}`;
        if (key in SENSITIVE_ALLOWED) usedSensitive.add(key);
        else sensitive.push(`${call.file}:${line} passes \`${name}\``);
      }
    }
  }
  return { usedSensitive, usedDynamic, sensitive, dynamic };
}

describe('log, crash-report and breadcrumb calls', () => {
  const calls = findCalls();
  const { usedSensitive, usedDynamic, sensitive, dynamic } = checkCalls(calls);

  it('finds the logging call sites (the scan works)', () => {
    expect(calls.length).toBeGreaterThan(20);
    const filesWithLogs = new Set(calls.map((call) => call.file));
    for (const file of [
      'src/services/auth.ts',
      'src/providers/spotify/auth.ts',
      'src/providers/spotify/api.ts',
      'src/services/providerCredentials.ts',
      'src/services/queryClient.ts',
      'src/features/auth/useAuthCallback.ts',
      'src/services/crashReporting.ts',
    ]) {
      expect(filesWithLogs).toContain(file);
    }
  });

  it('use fixed messages: data goes in the context, where its key decides', () => {
    expect(dynamic).toEqual([]);
  });

  it('never pass a value named like a token, email, code or song', () => {
    expect(sensitive).toEqual([]);
  });

  it('have no stale allowlist entries', () => {
    expect(Object.keys(SENSITIVE_ALLOWED).filter((key) => !usedSensitive.has(key))).toEqual([]);
    expect(Object.keys(DYNAMIC_MESSAGE_ALLOWED).filter((key) => !usedDynamic.has(key))).toEqual([]);
  });

  it('the name check catches what it should, and lets codes and ids through', () => {
    for (const name of [
      'accessToken',
      'refresh_token',
      'inviteToken',
      'email',
      'password',
      'code',
      'state',
      'codeVerifier',
      'codeChallenge',
      'roomCode',
      'trackTitle',
      'artist',
      'isrc',
      'query',
      'userId',
      'url',
    ]) {
      expect([name, isSensitiveName(name)]).toEqual([name, true]);
    }
    for (const name of ['errorCode', 'status', 'provider', 'step', 'roomId', 'error', 'reason']) {
      expect([name, isSensitiveName(name)]).toEqual([name, false]);
    }
  });
});

describe('the guard itself', () => {
  // Planted leaks, parsed in memory: each must be reported. If one stops being
  // caught, the scan above silently stopped protecting that shape of call.
  const planted = `
    import * as crash from './crashReporting';
    const deps = { log };
    export function leak(user: { email: string }, token: string, roomCode: string, title: string) {
      const { email } = user;
      logger.info('a', { email });
      log.info(\`joined \${roomCode}\`);
      authLog.warn('b', { accessToken: token });
      log.child('x').error('c', undefined, { reason: user.email });
      addBreadcrumb('Added', { title });
      crash.addBreadcrumb('Added', { title });
      crash.captureException(new Error('x'), { roomCode });
      deps.log.warn('d', { token });
      addBreadcrumb(\`Opened \${roomCode.length}\`);
      catalog.info('not a logger', { email });
      const e = user.email;
      log.info('alias', { e });
    }
  `;
  const file = 'src/planted.ts';
  const source = ts.createSourceFile(file, planted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { sensitive, dynamic } = checkCalls(callsIn(file, source));

  it('catches a leak in every call shape it knows', () => {
    expect(sensitive).toEqual([
      `${file}:6 passes \`email\``,
      `${file}:7 passes \`roomCode\``,
      `${file}:8 passes \`token\``,
      `${file}:9 passes \`user\``,
      `${file}:9 passes \`email\``,
      `${file}:10 passes \`title\``,
      `${file}:11 passes \`title\``,
      `${file}:12 passes \`roomCode\``,
      `${file}:13 passes \`token\``,
      `${file}:14 passes \`roomCode\``,
    ]);
    expect(dynamic).toEqual([`${file}:7`, `${file}:14`]);
  });

  it('has known blind spots, covered by the redactor and the runtime canaries', () => {
    // `catalog` isn't a logger name. An alias (`const e = user.email`) hides the
    // name: the static guard only sees names at the call site. The logger's
    // value scan still turns an email into [email]; a song title in an alias
    // isn't caught by anything but review.
    expect(sensitive.some((entry) => entry.startsWith(`${file}:15`))).toBe(false);
    expect(sensitive.some((entry) => entry.startsWith(`${file}:17`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. analytics

describe('analytics', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  it('no analytics or crash-reporting SDK is installed', () => {
    const sdk =
      /sentry|bugsnag|amplitude|mixpanel|segment|posthog|firebase|datadog|newrelic|appcenter|expo-insights|analytics|rollbar|logrocket|instabug|crashlytics|heap|braze|appsflyer|adjust/i;
    expect(installed.filter((name) => sdk.test(name))).toEqual([]);
  });

  it('nothing in the app, Edge Functions or scripts writes analytics_events', () => {
    const writers = files.filter((file) =>
      fs.readFileSync(path.join(ROOT, file), 'utf8').includes('analytics_events'),
    );
    expect(writers).toEqual([]);
  });
});
