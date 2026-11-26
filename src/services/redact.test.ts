import {
  isSensitiveKey,
  redact,
  redactContext,
  redactError,
  redactString,
  REDACTED,
} from './redact';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImFub24ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const INVITE = 'Zk3qP9xL2mN8vR4tY7wB1c'; // 22 URL-safe characters ≈ 128 bits
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';

/** Fails if any of these strings survive anywhere in the serialized value. */
function expectNoLeak(value: unknown, secrets: string[]) {
  const text = JSON.stringify(value);
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

describe('isSensitiveKey', () => {
  it.each([
    'token',
    'accessToken',
    'access_token',
    'refresh-token',
    'idToken',
    'providerToken',
    'inviteToken',
    'invite',
    'inviteUrl',
    'password',
    'clientSecret',
    'Authorization',
    'cookie',
    'apiKey',
    'publishableKey',
    'anon_key',
    'serviceRoleKey',
    'session',
    'email',
    'userEmail',
    'phoneNumber',
    'displayName',
    'code',
    'roomCode',
    'room_code',
    'joinCode',
    'title',
    'songTitle',
    'artist',
    'artists',
    'artistName',
    'album',
    'isrc',
    'trackId',
    'providerTrackId',
    'track',
    'tracks',
    'song',
    'recordingId',
    'playlist',
    'playlistId',
    'queue',
    'queueEntries',
    'history',
    'listeningHistory',
    'nowPlaying',
    'artworkUrl',
    'query',
    'searchQuery',
    'uri',
    'url',
    'name',
    'key',
    'headers',
    'body',
  ])('treats %j as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'roomId',
    'userId',
    'errorCode',
    'statusCode',
    'status',
    'attempt',
    'durationMs',
    'idempotencyKey',
    'provider',
    'screen',
    'count',
    'level',
    'mode',
    'isFatal',
  ])('keeps %j', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactString', () => {
  it.each([
    ['an email', 'Sign-in failed for ann.li+test@example.co.uk today', 'ann.li+test@example.co.uk'],
    ['a room code', 'Joined QD-7K4F9X', 'QD-7K4F9X'],
    ['a lower-case room code', 'joining qd-7k4f9x now', 'qd-7k4f9x'],
    ['a room code with a space', 'code QD 7K4F9X', 'QD 7K4F9X'],
    ['a room code without the dash', 'code QD7K4F9X.', 'QD7K4F9X'],
    ['a room code in a path', '/room/QD-9M2XR4/queue', 'QD-9M2XR4'],
    ['an invite link', 'qd://join?invite=' + INVITE, INVITE],
    ['an invite token alone', `token ${INVITE} expired`, INVITE],
    ['a JWT', `got ${JWT}`, JWT],
    ['a bearer header', 'Authorization: Bearer abc.def-123', 'abc.def-123'],
    ['a basic header', 'Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['an OAuth fragment', 'qd://auth#access_token=abc123&refresh_token=def456', 'abc123'],
    ['a refresh token param', 'qd://auth#access_token=abc123&refresh_token=def456', 'def456'],
    ['an OAuth code param', 'https://x.test/cb?code=AQBx99&state=s1', 'AQBx99'],
    ['an email param', 'https://x.test/?email=someone%40x.com', 'someone%40x.com'],
    ['a Supabase secret key', 'key sb_secret_abc123XYZ', 'sb_secret_abc123XYZ'],
    ['a Supabase publishable key', 'key sb_publishable_abc123', 'sb_publishable_abc123'],
    ['a Spotify URI', `playing spotify:track:${SPOTIFY_ID}`, SPOTIFY_ID],
    ['a Spotify link', `https://open.spotify.com/track/${SPOTIFY_ID}?si=1`, SPOTIFY_ID],
    ['an Apple Music link', 'see https://music.apple.com/us/album/x/1440857781?i=1', '1440857781'],
    ['an ISRC', 'isrc USUM71703861 matched', 'USUM71703861'],
    ['a hyphenated ISRC', 'isrc US-UM7-17-03861 matched', 'US-UM7-17-03861'],
    ['a bare Spotify id', `id ${SPOTIFY_ID}`, SPOTIFY_ID],
  ])('removes %s', (_label, input, secret) => {
    const output = redactString(input);
    expect(output).not.toContain(secret);
    expect(output.length).toBeGreaterThan(0);
  });

  it('labels what it removed', () => {
    expect(redactString('mail a@b.io in QD-7K4F9X')).toBe('mail [email] in [room-code]');
    expect(redactString(`Bearer ${JWT}`)).toBe('Bearer [token]');
    expect(redactString(`spotify:track:${SPOTIFY_ID}`)).toBe('[music-id]');
    expect(redactString('qd://join?invite=abc&x=1')).toBe('qd://join?invite=[redacted]&x=1');
  });

  it('keeps ordinary text, UUIDs, numbers and error codes', () => {
    const text =
      'Enqueue failed: not_allowed (attempt 2 of 3) room 3f2b6a1e-8c4d-4b7a-9e1f-0a2b3c4d5e6f in 120 ms';
    expect(redactString(text)).toBe(text);
    expect(redactString('NetworkRequestFailed')).toBe('NetworkRequestFailed');
    expect(redactString('')).toBe('');
  });

  it('removes the row a Postgres constraint error echoes (song titles, names)', () => {
    const details =
      'Failing row contains (5d1c, Rain Down, Delta Rae (Live), K7CN4R, Baron, null).';
    expect(redactString(details)).toBe('Failing row contains ([redacted]).');
    const message = 'new row violates check constraint; Failing row contains (x, Lovers Rock)';
    expect(redactString(message)).not.toContain('Lovers Rock');
  });

  it('removes the value an invalid-input error echoes, keeping the type', () => {
    expect(redactString('invalid input syntax for type uuid: "Rain Down"')).toBe(
      'invalid input syntax for type uuid: "[redacted]"',
    );
    expect(
      redactString('invalid input value for enum music_provider: "say \\"hi\\" Lovers Rock"'),
    ).toBe('invalid input value for enum music_provider: "[redacted]"');
  });

  it('caps very long strings', () => {
    const output = redactString('a'.repeat(5000));
    expect(output.length).toBe(2000);
    expect(output.endsWith('…')).toBe(true);
    expect(redactString(output)).toBe(output);
  });

  it('redacts before shortening, so nothing is cut in half and left readable', () => {
    const output = redactString(`${'x '.repeat(995)}a@b.io and more text after it`);
    expect(output).not.toContain('a@b');
    expect(output).toContain('[email]');
  });

  it('is idempotent', () => {
    const once = redactString(`a@b.io QD-7K4F9X ${JWT} spotify:track:${SPOTIFY_ID}`);
    expect(redactString(once)).toBe(once);
  });
});

describe('redact', () => {
  it('replaces whole values under sensitive keys, whatever their type', () => {
    expect(
      redact({
        accessToken: 'abc',
        email: 'a@b.io',
        roomCode: 'QD-7K4F9X',
        code: '7K4F9X',
        track: { title: 'Rain Down', artist: 'Delilah Montagu', isrc: 'GBARL1800001' },
        queue: [{ title: 'Song A' }, { title: 'Song B' }],
        title: 'Rain Down',
        artists: ['Someone', 'Someone Else'],
        query: 'rain down',
        attempt: 2,
        roomId: 'room-1',
      }),
    ).toEqual({
      accessToken: REDACTED,
      email: REDACTED,
      roomCode: REDACTED,
      code: REDACTED,
      track: REDACTED,
      queue: REDACTED,
      title: REDACTED,
      artists: REDACTED,
      query: REDACTED,
      attempt: 2,
      roomId: 'room-1',
    });
  });

  it('redacts deeply nested objects and arrays', () => {
    const input = {
      level1: {
        level2: [
          { note: 'from a@b.io', nested: { refreshToken: 'r-123' } },
          ['QD-7K4F9X', { songTitle: 'Rain Down' }],
        ],
      },
    };
    const output = redact(input);
    expectNoLeak(output, ['a@b.io', 'r-123', 'QD-7K4F9X', 'Rain Down']);
    expect(output).toEqual({
      level1: {
        level2: [
          { note: 'from [email]', nested: { refreshToken: REDACTED } },
          ['[room-code]', { songTitle: REDACTED }],
        ],
      },
    });
  });

  it('redacts sensitive strings used as keys', () => {
    const output = redact({ 'a@b.io': 1, 'QD-7K4F9X': 2 });
    expect(output).toEqual({ '[email]': 1, '[room-code]': 2 });
  });

  it('does not change the input', () => {
    const input = { email: 'a@b.io', list: ['QD-7K4F9X'] };
    const copy = structuredClone(input);
    redact(input);
    expect(input).toEqual(copy);
  });

  it('handles primitives', () => {
    expect(redact('a@b.io')).toBe('[email]');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(BigInt(10))).toBe('10');
    expect(redact(Symbol('s'))).toBe('Symbol(s)');
    expect(redact(() => 1)).toBe('[function]');
  });

  it('handles dates, regular expressions, Maps and Sets', () => {
    expect(redact(new Date('2026-11-24T10:00:00Z'))).toBe('2026-11-24T10:00:00.000Z');
    expect(redact(new Date('nope'))).toBe('Invalid Date');
    expect(redact(/QD-7K4F9X/)).toBe('/[room-code]/');
    expect(
      redact(
        new Map<string, unknown>([
          ['token', 'x'],
          ['note', 'a@b.io'],
        ]),
      ),
    ).toEqual({
      token: REDACTED,
      note: '[email]',
    });
    expect(redact(new Set(['a@b.io', 1]))).toEqual(['[email]', 1]);
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { label: 'root' };
    node.self = node;
    node.list = [node];
    expect(redact(node)).toEqual({ label: 'root', self: '[circular]', list: ['[circular]'] });
  });

  it('keeps repeated (non-circular) references', () => {
    const shared = { note: 'a@b.io' };
    expect(redact({ a: shared, b: shared })).toEqual({
      a: { note: '[email]' },
      b: { note: '[email]' },
    });
  });

  it('stops at a maximum depth', () => {
    let deep: Record<string, unknown> = { leaf: 'a@b.io' };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    const text = JSON.stringify(redact(deep));
    expect(text).toContain('[truncated]');
    expect(text).not.toContain('a@b.io');
  });

  it('caps long arrays', () => {
    const output = redact(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(output).toHaveLength(51);
    expect(output[50]).toBe('[10 more]');
  });
});

describe('redactError', () => {
  it('keeps the name and redacts the message and stack', () => {
    const error = new Error(`Couldn't join QD-7K4F9X as a@b.io with ${JWT}`);
    const output = redactError(error);
    expect(output.name).toBe('Error');
    expect(output.message).toBe("Couldn't join [room-code] as [email] with [token]");
    expect(output.stack).toBeDefined();
    expectNoLeak(output, ['QD-7K4F9X', 'a@b.io', JWT]);
  });

  it('removes free text in `code`, keeping code-shaped values', () => {
    const named = Object.assign(new Error('x'), { code: 'Rain Down by Delta Rae' });
    expect(redactError(named).code).toBe(REDACTED);
    for (const code of ['PGRST301', '23502', 'not_allowed', 'ERR_NETWORK', 'auth.expired']) {
      expect(redactError(Object.assign(new Error('x'), { code })).code).toBe(code);
    }
    expect(redactError(Object.assign(new Error('x'), { code: 401 })).code).toBe(401);
  });

  it('keeps a code and redacts extra fields by key', () => {
    const error = Object.assign(new Error('Request failed'), {
      code: 'PGRST301',
      status: 401,
      details: 'token for a@b.io expired',
      accessToken: 'abc',
      hint: null,
    });
    expect(redactError(error)).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'Request failed',
        code: 'PGRST301',
        status: 401,
        details: 'token for [email] expired',
        accessToken: REDACTED,
        hint: null,
      }),
    );
  });

  it('redacts a nested cause', () => {
    const cause = new TypeError('fetch failed for QD-7K4F9X');
    const error = new Error('Join failed', { cause });
    const output = redactError(error);
    expect(output.cause).toEqual(
      expect.objectContaining({ name: 'TypeError', message: 'fetch failed for [room-code]' }),
    );
  });

  it('handles an error whose cause is itself', () => {
    const error = new Error('loop') as Error & { cause?: unknown };
    error.cause = error;
    expect(redactError(error).cause).toBe('[circular]');
  });

  it('handles custom error subclasses', () => {
    class ProviderError extends Error {
      constructor(
        message: string,
        readonly code: string,
        readonly track: { title: string },
      ) {
        super(message);
        this.name = 'ProviderError';
      }
    }
    const output = redactError(new ProviderError('no match', 'not_found', { title: 'Rain Down' }));
    expect(output).toEqual(
      expect.objectContaining({ name: 'ProviderError', code: 'not_found', track: REDACTED }),
    );
    expectNoLeak(output, ['Rain Down']);
  });

  it('treats a plain error object (like a Supabase PostgrestError) as an error', () => {
    const postgrestError = {
      message: 'duplicate key for a@b.io',
      code: '23505',
      details: 'Key (code)=(7K4F9X) already exists in QD-7K4F9X',
      hint: null,
    };
    expect(redactError(postgrestError)).toEqual({
      name: 'Error',
      message: 'duplicate key for [email]',
      code: '23505',
      details: 'Key (code)=([redacted]) already exists in [room-code]',
      hint: null,
    });
  });

  it('is stable for an error that was already redacted', () => {
    const once = redactError(new Error('mail a@b.io'));
    expect(redactError(once)).toEqual(once);
  });

  it('handles errors nested in objects', () => {
    const output = redact({ error: new Error('mail a@b.io') }) as { error: { message: string } };
    expect(output.error.message).toBe('mail [email]');
  });

  it.each([
    ['a string', 'bad QD-7K4F9X', 'bad [room-code]'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['an object', { email: 'a@b.io', note: 'hi' }, '{"email":"[redacted]","note":"hi"}'],
  ])('wraps a thrown non-error (%s)', (_label, thrown, message) => {
    expect(redactError(thrown)).toEqual({ name: 'NonError', message });
  });
});

describe('redactContext', () => {
  it('returns objects as objects and wraps anything else', () => {
    expect(redactContext({ email: 'x' })).toEqual({ email: REDACTED });
    expect(redactContext('a@b.io')).toEqual({ value: '[email]' });
    expect(redactContext(['a@b.io'])).toEqual({ value: ['[email]'] });
    expect(redactContext(null)).toEqual({ value: null });
  });
});

describe('a realistic payload', () => {
  it('leaks nothing from a Supabase session, a queue and a provider response', () => {
    const secrets = [
      JWT,
      'refresh-abc-123',
      'ann@example.com',
      'QD-7K4F9X',
      INVITE,
      'Rain Down',
      'Delilah Montagu',
      'USUM71703861',
      SPOTIFY_ID,
      'Ann Li',
    ];
    const payload = {
      session: { access_token: JWT, refresh_token: 'refresh-abc-123' },
      user: { id: 'u-1', email: 'ann@example.com' },
      profile: { displayName: 'Ann Li', avatarColor: 'violet' },
      room: { id: 'r-1', code: 'QD-7K4F9X', inviteUrl: `qd://join?invite=${INVITE}` },
      entries: [
        {
          id: 'e-1',
          recording: { title: 'Rain Down', artists: ['Delilah Montagu'], isrc: 'USUM71703861' },
        },
      ],
      spotify: { items: [{ id: SPOTIFY_ID, uri: `spotify:track:${SPOTIFY_ID}` }] },
      message: `Failed for ann@example.com in QD-7K4F9X on spotify:track:${SPOTIFY_ID}`,
    };
    expectNoLeak(redact(payload), secrets);
  });
});
