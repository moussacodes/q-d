import type { SupabaseClient } from '@supabase/supabase-js';

import { addLogSink, type LogEntry } from './logger';
import { saveOnboardingProfile, updateProfile } from './profiles';

type Answer = { data: { id: string }[] | null; error: { code?: string; message?: string } | null };

/** Just `from('profiles').update(columns).eq('id', id).select('id')`. */
function fakeClient(answer: Answer | (() => Promise<Answer>)) {
  const select = jest.fn((_columns: string) =>
    typeof answer === 'function' ? answer() : Promise.resolve(answer),
  );
  const eq = jest.fn((_column: string, _value: string) => ({ select }));
  const update = jest.fn((_columns: Record<string, unknown>) => ({ eq }));
  const from = jest.fn((_table: string) => ({ update }));
  return { client: { from } as unknown as SupabaseClient, from, update, eq, select };
}

const USER = 'user-1';
const NOW = new Date('2026-11-26T10:00:00.000Z');
const profile = { displayName: 'Sam', color: '#8fb4f0' };

let entries: LogEntry[];
let removeSink: () => void;

beforeEach(() => {
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

describe('saveOnboardingProfile', () => {
  it('updates only the caller’s own row, with exactly the three onboarding columns', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    expect(
      await saveOnboardingProfile(USER, profile, { client: fake.client, now: () => NOW }),
    ).toEqual({ ok: true });
    expect(fake.from).toHaveBeenCalledWith('profiles');
    expect(fake.update).toHaveBeenCalledWith({
      display_name: 'Sam',
      color: '#8fb4f0',
      adult_confirmed_at: '2026-11-26T10:00:00.000Z',
    });
    expect(fake.eq).toHaveBeenCalledWith('id', USER);
    expect(fake.select).toHaveBeenCalledWith('id');
  });

  it('says not_configured without a client, and sends nothing', async () => {
    expect(await saveOnboardingProfile(USER, profile, { client: null })).toEqual({
      ok: false,
      error: 'not_configured',
    });
  });

  it('treats an update that matched no row as signed out (RLS hid the row)', async () => {
    const fake = fakeClient({ data: [], error: null });
    expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
      ok: false,
      error: 'not_signed_in',
    });
  });

  it('treats a null result the same way', async () => {
    const fake = fakeClient({ data: null, error: null });
    expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
      ok: false,
      error: 'not_signed_in',
    });
  });

  it.each([
    ['23514', 'rejected'],
    ['22001', 'rejected'],
    ['42501', 'rejected'],
    ['23502', 'rejected'],
    ['22P02', 'rejected'],
    ['PGRST301', 'not_signed_in'],
    ['PGRST303', 'not_signed_in'],
    ['XX000', 'unknown'],
  ] as const)('maps database code %s to %s', async (code, error) => {
    const fake = fakeClient({ data: null, error: { code, message: 'whatever' } });
    expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
      ok: false,
      error,
    });
    expect(entries.at(-1)?.context).toMatchObject({ step: 'onboarding', result: error });
  });

  it.each(['TypeError: Network request failed', 'Failed to fetch', 'The request timed out'])(
    'reports %p without a code as network',
    async (message) => {
      const fake = fakeClient({ data: null, error: { message } });
      expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
        ok: false,
        error: 'network',
      });
    },
  );

  it('reports supabase-js’s fetch failure (an empty code) as network', async () => {
    // What postgrest-js returns when fetch itself fails.
    const fake = fakeClient({
      data: null,
      error: { code: '', message: 'TypeError: Network request failed' },
    });
    expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('reports a thrown request as network', async () => {
    const fake = fakeClient(() => Promise.reject(new TypeError('Network request failed')));
    expect(await saveOnboardingProfile(USER, profile, { client: fake.client })).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('logs the step, the result and a code-shaped database code, never the values', async () => {
    const fake = fakeClient({
      data: null,
      error: {
        code: '23514',
        message: `new row for relation "profiles" violates check constraint. Failing row contains (${USER}, Canary Name, #8fb4f0).`,
      },
    });
    await saveOnboardingProfile(
      USER,
      { displayName: 'Canary Name', color: '#8fb4f0' },
      {
        client: fake.client,
      },
    );
    expect(entries.at(-1)?.context).toEqual({
      step: 'onboarding',
      result: 'rejected',
      dbCode: '23514',
    });
    const text = JSON.stringify(entries);
    expect(text).not.toContain('Canary Name');
    expect(text).not.toContain('#8fb4f0');
    expect(text).not.toContain(USER);
  });

  it('logs a success with the field names only', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    await saveOnboardingProfile(
      USER,
      { displayName: 'Canary Name', color: '#8fb4f0' },
      {
        client: fake.client,
      },
    );
    expect(entries.map((entry) => entry.context)).toEqual([
      { step: 'onboarding', fields: ['adult_confirmed_at', 'color', 'display_name'] },
    ]);
    expect(JSON.stringify(entries)).not.toContain('Canary Name');
  });

  it('logs a free-text database code as other', async () => {
    const fake = fakeClient({ data: null, error: { code: 'Canary Name was refused' } });
    await saveOnboardingProfile(USER, profile, { client: fake.client });
    expect(entries.at(-1)?.context).toMatchObject({ dbCode: 'other' });
    expect(JSON.stringify(entries)).not.toContain('Canary Name');
  });
});

describe('updateProfile', () => {
  it('sends only the name when only the name changed, and never the 18+ field', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    expect(await updateProfile(USER, { displayName: 'Maya' }, fake.client)).toEqual({ ok: true });
    expect(fake.update).toHaveBeenCalledWith({ display_name: 'Maya' });
    expect(fake.eq).toHaveBeenCalledWith('id', USER);
  });

  it('sends only the color when only the color changed', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    await updateProfile(USER, { color: '#e8c547' }, fake.client);
    expect(fake.update).toHaveBeenCalledWith({ color: '#e8c547' });
  });

  it('sends both when both changed', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    await updateProfile(USER, { displayName: 'Maya', color: '#e8c547' }, fake.client);
    expect(fake.update).toHaveBeenCalledWith({ display_name: 'Maya', color: '#e8c547' });
    expect(entries.at(-1)?.context).toEqual({
      step: 'settings',
      fields: ['color', 'display_name'],
    });
  });

  it('sends nothing for an empty change', async () => {
    const fake = fakeClient({ data: [{ id: USER }], error: null });
    expect(await updateProfile(USER, {}, fake.client)).toEqual({ ok: true });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('reports failures like onboarding does', async () => {
    const fake = fakeClient({ data: null, error: { message: 'Failed to fetch' } });
    expect(await updateProfile(USER, { color: '#e8c547' }, fake.client)).toEqual({
      ok: false,
      error: 'network',
    });
    expect(entries.at(-1)?.context).toMatchObject({ step: 'settings', result: 'network' });
  });
});
