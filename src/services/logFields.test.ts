import { z } from 'zod';

import { loggableDbCode, zodIssueFields } from './logFields';

describe('zodIssueFields', () => {
  it('keeps field paths and issue kinds, never the value or message', () => {
    const parsed = z
      .object({ title: z.number(), nested: z.object({ name: z.string().min(3) }) })
      .safeParse({ title: 'Secret Song Title', nested: { name: 'Al' } });
    if (parsed.success) throw new Error('expected a failure');
    const fields = zodIssueFields(parsed.error);
    expect(fields).toEqual([
      { path: 'title', kind: 'invalid_type' },
      { path: 'nested.name', kind: 'too_small' },
    ]);
    expect(JSON.stringify(fields)).not.toContain('Secret Song Title');
    expect(JSON.stringify(fields)).not.toContain('Al"');
  });
});

describe('loggableDbCode', () => {
  it.each(['PGRST116', '23505', 'P0001', '42501'])('keeps %s', (code) => {
    expect(loggableDbCode(code)).toBe(code);
  });

  it.each([null, undefined, ''])('returns null for %p', (code) => {
    expect(loggableDbCode(code)).toBeNull();
  });

  it.each(['K7QX2M', 'QD-K7QX2M', 'room ABCD', 'eyJhbGciOi.token', 'pgrst116'])(
    'logs %p as other',
    (code) => {
      expect(loggableDbCode(code)).toBe('other');
    },
  );
});
