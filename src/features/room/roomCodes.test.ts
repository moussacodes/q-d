import { mockRooms } from '@/providers/mock/data';

import { joinErrorCopy, mockErrorCodes, normalizeCode, roomCodes } from './roomCodes';

describe('normalizeCode', () => {
  it.each([
    ['7K4F9X', '7K4F9X'],
    ['7k4f9x', '7K4F9X'],
    ['QD-7K4F9X', '7K4F9X'],
    ['qd-7k4f 9x', '7K4F9X'],
    ['  qd7k4f9x', '7K4F9X'],
    ['7K-4F-9X', '7K4F9X'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCode(input)).toBe(expected);
  });
});

describe('mock join_room_by_code', () => {
  it('finds every sample room by its code, with or without the prefix', async () => {
    for (const room of mockRooms) {
      expect(await roomCodes.lookup(room.code)).toEqual({ ok: true, room });
      expect(await roomCodes.lookup(room.code.slice(3).toLowerCase())).toEqual({ ok: true, room });
    }
  });

  it.each(Object.entries(mockErrorCodes))('gives %s for its made-up code', async (error, code) => {
    expect(await roomCodes.lookup(code)).toEqual({ ok: false, error });
  });

  it('answers wrong and expired codes the same way, so codes can’t be probed', async () => {
    expect(await roomCodes.lookup('ZZZZZZ')).toEqual({ ok: false, error: 'code_invalid' });
    expect(await roomCodes.lookup('7K4F9Y')).toEqual({ ok: false, error: 'code_invalid' });
  });

  it('has copy for every error, naming q’d with the curly apostrophe', () => {
    const errors = [
      'code_invalid',
      ...Object.keys(mockErrorCodes),
    ] as (keyof typeof joinErrorCopy)[];
    for (const error of errors) {
      expect(joinErrorCopy[error].title).not.toHaveLength(0);
      expect(joinErrorCopy[error].body).not.toHaveLength(0);
    }
    expect(joinErrorCopy.network.title).toBe('Can’t reach q’d');
    expect(JSON.stringify(joinErrorCopy)).not.toContain("q'd");
  });

  it('keeps the made-up codes apart from the sample rooms', () => {
    const sample = new Set(mockRooms.map((room) => normalizeCode(room.code)));
    Object.values(mockErrorCodes).forEach((code) => expect(sample.has(code)).toBe(false));
  });
});
