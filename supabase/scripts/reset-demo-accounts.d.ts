// Types for reset-demo-accounts.js, which stays plain JavaScript so Node runs
// it without a build step. supabase/tests/reset-demo-accounts-script.test.ts
// checks the two stay in step.

export type Env = Record<string, string | undefined>;

export type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export type Config = {
  baseUrl: string;
  host: string;
  serviceRoleKey: string;
  userIds: string[];
  emails: string[];
};

export type ResetResult = {
  applied: boolean;
  users: number;
  rooms_ended: number;
  invites_revoked: number;
  queue_entries_deleted: number;
  import_batches_deleted: number;
  memberships_deleted: number;
  idempotency_keys_deleted: number;
  join_attempts_deleted: number;
  memberships_elsewhere: number;
  profiles_incomplete: number;
  users_without_service: number;
};

export type Client = {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  listUsers(page: number, perPage: number): Promise<{ id: string; email?: string | null }[]>;
};

export const USAGE: string;
export class UsageError extends Error {}
export class RequestError extends Error {
  readonly status: number;
  readonly qdCode: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(status: number, body: unknown);
}

export function parseArgs(argv: string[]): { apply: boolean; help: boolean };
export function readConfig(env: Env): Config;
export function createClient(config: Config, fetchImpl: FetchLike): Client;
export function resolveUserIds(client: Client, config: Config): Promise<string[]>;
export function formatSummary(result: Partial<ResetResult>, applied: boolean): string;
export function describeError(error: unknown): string;
export function main(options: {
  argv: string[];
  env: Env;
  fetch: FetchLike;
  out: (line: string) => void;
  err: (line: string) => void;
}): Promise<number>;
