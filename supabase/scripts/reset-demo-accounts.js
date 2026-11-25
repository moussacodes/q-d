#!/usr/bin/env node
/*
 * Resets the demo accounts in the demo Supabase project before a rehearsal or
 * the demo (docs/DEMO_RUNBOOK.md § Reset between rehearsals). It calls the
 * operator-only `reset_demo_accounts` function with the service-role key.
 *
 *   node --env-file=.env.demo.local supabase/scripts/reset-demo-accounts.js          # dry run
 *   node --env-file=.env.demo.local supabase/scripts/reset-demo-accounts.js --yes    # apply
 *
 * Environment (names in .env.example; values never committed):
 *   SUPABASE_URL               the demo project's URL
 *   SUPABASE_SERVICE_ROLE_KEY  its service-role (secret) key. Server-only: never EXPO_PUBLIC_*
 *   QD_DEMO_USER_IDS           demo account ids, separated by commas or spaces
 *   QD_DEMO_EMAILS             and/or their sign-in emails, looked up with the admin API
 *
 * A dry run is the default and changes nothing. The output is counts only:
 * never an email, user id, room code, token or key.
 *
 * Plain CommonJS with no dependencies, so it runs on any Node the repo
 * supports (22.13+) without a build step. Tests inject `fetch`.
 */
'use strict';

const FUNCTION_NAME = 'reset_demo_accounts';
const ADMIN_PAGE_SIZE = 1000;
const ADMIN_MAX_PAGES = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

const USAGE = [
  'Usage: node supabase/scripts/reset-demo-accounts.js [--dry-run | --yes]',
  '',
  '  --dry-run  Show what would change. The default.',
  '  --yes      Apply the reset.',
  '  --help     Show this text.',
  '',
  'Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and QD_DEMO_USER_IDS and/or',
  'QD_DEMO_EMAILS from the environment. See docs/DEMO_RUNBOOK.md.',
].join('\n');

/** A mistake the operator can fix; printed without a stack trace. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Reads the command line. Dry run unless `--yes`. */
function parseArgs(argv) {
  let yes = false;
  let dryRun = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--yes') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else throw new UsageError(`Unknown argument. Expected --dry-run, --yes or --help.`);
  }
  if (yes && dryRun) throw new UsageError('Pass either --dry-run or --yes, not both.');
  return { apply: yes, help };
}

const splitList = (value) =>
  (value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');

/** Reads and checks the environment. Messages never echo a value. */
function readConfig(env) {
  const rawUrl = (env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (rawUrl === '') throw new UsageError('SUPABASE_URL is not set.');
  if (serviceRoleKey === '') throw new UsageError('SUPABASE_SERVICE_ROLE_KEY is not set.');

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError('SUPABASE_URL is not a URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new UsageError('SUPABASE_URL must use https (http only for a local stack).');
  }

  const userIds = splitList(env.QD_DEMO_USER_IDS);
  const emails = splitList(env.QD_DEMO_EMAILS);
  if (userIds.length === 0 && emails.length === 0) {
    throw new UsageError('Set QD_DEMO_USER_IDS or QD_DEMO_EMAILS: the reset needs a list.');
  }
  const badIds = userIds.filter((id) => !UUID.test(id)).length;
  if (badIds > 0) throw new UsageError(`QD_DEMO_USER_IDS has ${badIds} entry(s) that aren't ids.`);
  const badEmails = emails.filter((email) => !EMAIL.test(email)).length;
  if (badEmails > 0) {
    throw new UsageError(`QD_DEMO_EMAILS has ${badEmails} entry(s) that aren't emails.`);
  }

  return {
    baseUrl: url.origin,
    host: url.host,
    serviceRoleKey,
    userIds: userIds.map((id) => id.toLowerCase()),
    emails: emails.map((email) => email.toLowerCase()),
  };
}

/** A failed request. `qdCode` is set for q’d errors (API_CONTRACTS.md §2). */
class RequestError extends Error {
  constructor(status, body) {
    const qd = body && typeof body === 'object' && body.hint === 'qd';
    super(qd ? `${body.message}` : `HTTP ${status}`);
    this.name = 'RequestError';
    this.status = status;
    this.qdCode = qd ? body.message : undefined;
    this.details = undefined;
    if (qd && typeof body.details === 'string') {
      try {
        this.details = JSON.parse(body.details);
      } catch {
        this.details = undefined;
      }
    }
  }
}

/** The two endpoints the script uses, over plain fetch. */
function createClient(config, fetchImpl) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok) throw new RequestError(response.status, body);
    return body;
  };
  return {
    rpc: (name, args) =>
      request(`/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      }),
    listUsers: async (page, perPage) => {
      const body = await request(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
      return Array.isArray(body?.users) ? body.users : [];
    },
  };
}

/** The ids to reset: QD_DEMO_USER_IDS plus the accounts of QD_DEMO_EMAILS. */
async function resolveUserIds(client, config) {
  const ids = new Set(config.userIds);
  const wanted = new Set(config.emails);
  for (let page = 1; wanted.size > 0 && page <= ADMIN_MAX_PAGES; page += 1) {
    const users = await client.listUsers(page, ADMIN_PAGE_SIZE);
    for (const user of users) {
      const email = typeof user?.email === 'string' ? user.email.toLowerCase() : null;
      if (email !== null && wanted.has(email)) {
        ids.add(String(user.id).toLowerCase());
        wanted.delete(email);
      }
    }
    if (users.length < ADMIN_PAGE_SIZE) break;
  }
  if (wanted.size > 0) {
    throw new UsageError(`${wanted.size} demo email(s) have no account in this project.`);
  }
  return [...ids].sort();
}

// [result key, dry-run label, applied label]
const LINES = [
  ['rooms_ended', 'live rooms to end', 'live rooms ended'],
  ['invites_revoked', 'live invites to revoke', 'live invites revoked'],
  ['queue_entries_deleted', 'queue entries to delete', 'queue entries deleted'],
  ['import_batches_deleted', 'import batches to delete', 'import batches deleted'],
  ['memberships_deleted', 'room memberships to delete', 'room memberships deleted'],
  ['idempotency_keys_deleted', 'idempotency keys to delete', 'idempotency keys deleted'],
  ['join_attempts_deleted', 'failed join attempts to delete', 'failed join attempts deleted'],
];

const NOTES = [
  ['memberships_elsewhere', 'membership(s) in rooms other people host (left alone)'],
  ['profiles_incomplete', 'account(s) without a finished profile (finish onboarding in the app)'],
  ['users_without_service', 'account(s) with no music service connected (fine for the guest)'],
];

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** The summary the operator sees. Counts only. */
function formatSummary(result, applied) {
  const lines = [
    applied ? 'Reset applied:' : 'Dry run. Nothing changed. Run with --yes to apply:',
    `  accounts: ${count(result.users)}`,
  ];
  for (const [key, planned, done] of LINES) {
    lines.push(`  ${applied ? done : planned}: ${count(result[key])}`);
  }
  for (const [key, label] of NOTES) {
    const n = count(result[key]);
    if (n > 0) lines.push(`  note: ${n} ${label}`);
  }
  return lines.join('\n');
}

function describeError(error) {
  if (error instanceof UsageError) return error.message;
  if (error instanceof RequestError) {
    if (error.qdCode === 'feature_disabled') {
      return 'The demo_reset flag is off in this project. Only the demo project turns it on (see docs/DEMO_RUNBOOK.md).';
    }
    if (error.qdCode === 'invalid_input' && error.details?.reason === 'unknown_user') {
      return `${count(error.details.count)} demo id(s) have no account in this project.`;
    }
    if (error.qdCode === 'limit_exceeded') {
      return `Too many accounts: the reset takes at most ${count(error.details?.limit)}.`;
    }
    if (error.qdCode) return `The reset was refused: ${error.qdCode}.`;
    if (error.status === 401 || error.status === 403) {
      return `The project refused the key (HTTP ${error.status}). Use the service-role key.`;
    }
    return `The request failed (HTTP ${error.status}).`;
  }
  return 'The request failed (network or unexpected error).';
}

/**
 * Runs the script. Returns the exit code. `out` and `err` take one line each.
 * Nothing it prints contains an email, id, room code, token or key.
 */
async function main({ argv, env, fetch: fetchImpl, out, err }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    err(describeError(error));
    err(USAGE);
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }
  try {
    const config = readConfig(env);
    const client = createClient(config, fetchImpl);
    const userIds = await resolveUserIds(client, config);
    out(`Project: ${config.host}`);
    const result = await client.rpc(FUNCTION_NAME, { user_ids: userIds, apply: args.apply });
    out(formatSummary(result ?? {}, args.apply));
    return 0;
  } catch (error) {
    err(describeError(error));
    return 1;
  }
}

module.exports = {
  USAGE,
  UsageError,
  RequestError,
  parseArgs,
  readConfig,
  createClient,
  resolveUserIds,
  formatSummary,
  describeError,
  main,
};

if (require.main === module) {
  main({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
