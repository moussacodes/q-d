import { addLogSink, consoleSink, createLogger, log, type LogEntry } from './logger';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function setup(minLevel?: 'debug' | 'info' | 'warn' | 'error') {
  const entries: LogEntry[] = [];
  const logger = createLogger({
    minLevel,
    sinks: [(entry) => entries.push(entry)],
    now: () => NOW,
  });
  return { entries, logger };
}

describe('createLogger', () => {
  it('writes structured entries', () => {
    const { entries, logger } = setup();
    logger.info('Room opened', { roomId: 'r-1', attempt: 1 });
    expect(entries).toEqual([
      {
        level: 'info',
        message: 'Room opened',
        time: '2026-11-24T12:00:00.000Z',
        context: { roomId: 'r-1', attempt: 1 },
      },
    ]);
  });

  it('omits context and error when not given', () => {
    const { entries, logger } = setup();
    logger.debug('Tick');
    expect(entries[0]).toEqual({ level: 'debug', message: 'Tick', time: NOW.toISOString() });
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('writes at %s', (level) => {
    const { entries, logger } = setup();
    if (level === 'error') logger.error('m');
    else logger[level]('m');
    expect(entries[0]?.level).toBe(level);
  });

  it('drops entries below the minimum level', () => {
    const { entries, logger } = setup('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(entries.map((entry) => entry.message)).toEqual(['c', 'd']);
  });

  it('redacts the message, the context and the error before any sink sees them', () => {
    const { entries, logger } = setup();
    logger.error(
      'Join failed for a@b.io in QD-7K4F9X',
      new Error('token eyJhbGciOiJI.eyJzdWIiOiIx.sig rejected'),
      {
        accessToken: 'abc',
        track: { title: 'Rain Down', artist: 'Someone' },
        nested: [{ email: 'c@d.io' }],
      },
    );
    const text = JSON.stringify(entries);
    for (const secret of ['a@b.io', 'QD-7K4F9X', 'eyJhbGciOiJI', 'abc', 'Rain Down', 'c@d.io']) {
      expect(text).not.toContain(secret);
    }
    expect(entries[0]).toEqual(
      expect.objectContaining({
        message: 'Join failed for [email] in [room-code]',
        context: {
          accessToken: '[redacted]',
          track: '[redacted]',
          nested: [{ email: '[redacted]' }],
        },
        error: expect.objectContaining({ name: 'Error', message: 'token [token] rejected' }),
      }),
    );
  });

  it('accepts a thrown non-error', () => {
    const { entries, logger } = setup();
    logger.error('Failed', 'string thrown with a@b.io');
    expect(entries[0]?.error).toEqual({ name: 'NonError', message: 'string thrown with [email]' });
  });

  it('wraps a non-object context', () => {
    const { entries, logger } = setup();
    logger.info('x', ['a@b.io'] as unknown as object);
    expect(entries[0]?.context).toEqual({ value: ['[email]'] });
  });

  it('scopes child loggers and nests their scopes', () => {
    const { entries, logger } = setup();
    const room = logger.child('room');
    room.info('a');
    room.child('queue').warn('b');
    expect(entries.map((entry) => entry.scope)).toEqual(['room', 'room.queue']);
  });

  it('keeps the minimum level in child loggers', () => {
    const { entries, logger } = setup('error');
    logger.child('room').warn('dropped');
    expect(entries).toEqual([]);
  });

  it('keeps going when a sink throws', () => {
    const received: string[] = [];
    const logger = createLogger({
      sinks: [
        () => {
          throw new Error('broken sink');
        },
        (entry) => received.push(entry.message),
      ],
    });
    expect(() => logger.warn('still logged')).not.toThrow();
    expect(received).toEqual(['still logged']);
  });

  it('works with no sinks', () => {
    expect(() => createLogger().error('nothing listens')).not.toThrow();
  });
});

describe('consoleSink', () => {
  function fakeConsole() {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }

  it('prints the scope and message, with data only when there is some', () => {
    const target = fakeConsole();
    const sink = consoleSink(target);
    sink({ level: 'warn', message: 'Slow', time: '', scope: 'room' });
    sink({ level: 'info', message: 'Plain', time: '' });
    sink({
      level: 'error',
      message: 'Bad',
      time: '',
      context: { attempt: 1 },
      error: { name: 'Error', message: 'x' },
    });
    expect(target.warn).toHaveBeenCalledWith('[room] Slow');
    expect(target.info).toHaveBeenCalledWith('Plain');
    expect(target.error).toHaveBeenCalledWith('Bad', {
      attempt: 1,
      error: { name: 'Error', message: 'x' },
    });
    expect(target.debug).not.toHaveBeenCalled();
  });
});

describe('the app logger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('prints redacted entries to the console', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('Invite QD-7K4F9X expired', { email: 'a@b.io' });
    expect(warn).toHaveBeenCalledWith('Invite [room-code] expired', { email: '[redacted]' });
  });

  it('forwards entries to added sinks until they are removed', () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const seen: LogEntry[] = [];
    const remove = addLogSink((entry) => seen.push(entry));
    log.info('one', { email: 'a@b.io' });
    remove();
    log.info('two');
    expect(seen.map((entry) => entry.message)).toEqual(['one']);
    expect(seen[0]?.context).toEqual({ email: '[redacted]' });
  });

  it('keeps forwarding when an added sink throws', () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const seen: string[] = [];
    const removeBroken = addLogSink(() => {
      throw new Error('broken');
    });
    const removeGood = addLogSink((entry) => seen.push(entry.message));
    expect(() => log.info('still here')).not.toThrow();
    removeBroken();
    removeGood();
    expect(seen).toEqual(['still here']);
  });
});
