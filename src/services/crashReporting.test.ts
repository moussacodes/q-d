import {
  addBreadcrumb,
  allowedTags,
  beforeSend,
  captureException,
  clearBreadcrumbs,
  crashReportingPolicy,
  installGlobalErrorHandler,
  setCrashTransport,
  type CrashEvent,
} from './crashReporting';
import { log } from './logger';

const SECRETS = ['a@b.io', 'QD-7K4F9X', 'Rain Down', 'secret-token-1', 'Ann Li'];

function expectNoLeak(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe('beforeSend', () => {
  it('keeps only allowlisted fields and redacts them', () => {
    const event = beforeSend({
      level: 'fatal',
      message: 'Crash in QD-7K4F9X for a@b.io',
      time: '2026-11-24T12:00:00.000Z',
      error: new Error('Load failed for a@b.io'),
      context: { accessToken: 'secret-token-1', roomId: 'r-1' },
      tags: { platform: 'ios', appVersion: '1.0.0', email: 'a@b.io', userName: 'Ann Li' },
      breadcrumbs: [{ message: 'Opened QD-7K4F9X', time: 't', data: { title: 'Rain Down' } }],
      user: { id: 'u-1', email: 'a@b.io', name: 'Ann Li' },
      request: { headers: { Authorization: 'Bearer secret-token-1' }, data: 'a@b.io' },
      extra: { anything: 'a@b.io' },
      contexts: { device: { name: "Ann Li's iPhone" } },
      replay: { id: 'r' },
      attachments: [{ filename: 'screenshot.png' }],
    });
    expect(event).toEqual({
      level: 'fatal',
      message: 'Crash in [room-code] for [email]',
      time: '2026-11-24T12:00:00.000Z',
      error: expect.objectContaining({ name: 'Error' }),
      context: { accessToken: '[redacted]', roomId: 'r-1' },
      tags: { platform: 'ios', appVersion: '1.0.0' },
      breadcrumbs: [{ message: 'Opened [room-code]', time: 't', data: { title: '[redacted]' } }],
    });
    expectNoLeak(event);
  });

  it.each([null, undefined, 'text', 42, {}, { level: 'error' }, { message: '' }])(
    'drops an event with nothing to report (%j)',
    (input) => {
      expect(beforeSend(input)).toBeNull();
    },
  );

  it('uses the error message when there is no message', () => {
    expect(beforeSend({ error: new Error('boom at QD-7K4F9X') })).toEqual(
      expect.objectContaining({ level: 'error', message: 'boom at [room-code]' }),
    );
  });

  it('treats unknown levels as error and fills in a time', () => {
    const event = beforeSend({ level: 'debug', message: 'x' });
    expect(event?.level).toBe('error');
    expect(typeof event?.time).toBe('string');
  });

  it('keeps only simple allowlisted tags and caps their length', () => {
    const event = beforeSend({
      message: 'x',
      tags: { platform: 'x'.repeat(100), screen: { nested: true }, dataMode: 'mock', os: 1 },
    });
    expect(event?.tags).toEqual({ platform: 'x'.repeat(64), dataMode: 'mock', os: '1' });
    expect(beforeSend({ message: 'x', tags: { userId: 'u' } })?.tags).toBeUndefined();
    expect(beforeSend({ message: 'x', tags: 'nope' })?.tags).toBeUndefined();
  });

  it('keeps at most 20 breadcrumbs and drops malformed ones', () => {
    const crumbs = [
      ...Array.from({ length: 25 }, (_, i) => ({ message: `step ${i}`, time: 't' })),
      null,
      { time: 'no message' },
    ];
    const event = beforeSend({ message: 'x', breadcrumbs: crumbs });
    expect(event?.breadcrumbs).toHaveLength(18);
    expect(beforeSend({ message: 'x', breadcrumbs: [null] })?.breadcrumbs).toBeUndefined();
  });

  it('allows no identifying tags', () => {
    for (const tag of allowedTags) {
      expect(tag).not.toMatch(/user|email|name|device|ip|code|token/i);
    }
  });
});

describe('policy', () => {
  it('turns off session replay, automatic capture and PII', () => {
    expect(Object.values(crashReportingPolicy).every((value) => value === false)).toBe(true);
    expect(crashReportingPolicy).toEqual({
      sessionReplay: false,
      automaticBreadcrumbs: false,
      automaticEventCapture: false,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
    });
  });
});

describe('reporting', () => {
  let sent: CrashEvent[];

  beforeEach(() => {
    sent = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setCrashTransport(null);
    jest.restoreAllMocks();
  });

  it('sends nothing without a transport', () => {
    const transport = jest.fn();
    captureException(new Error('x'));
    addBreadcrumb('step');
    log.error('logged', new Error('y'));
    expect(transport).not.toHaveBeenCalled();
    setCrashTransport(transport);
    captureException(new Error('z'));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].breadcrumbs).toBeUndefined();
  });

  it('sends a redacted exception with manual breadcrumbs', () => {
    setCrashTransport((event) => {
      sent.push(event);
    });
    addBreadcrumb('Opened room QD-7K4F9X', { title: 'Rain Down', screen: 'room' });
    captureException(new Error('Failed for a@b.io'), { accessToken: 'secret-token-1' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        message: 'Failed for [email]',
        context: { accessToken: '[redacted]' },
        breadcrumbs: [
          expect.objectContaining({
            message: 'Opened room [room-code]',
            data: { title: '[redacted]', screen: 'room' },
          }),
        ],
      }),
    );
    expectNoLeak(sent);
  });

  it('keeps the last 20 breadcrumbs and can clear them', () => {
    setCrashTransport((event) => {
      sent.push(event);
    });
    for (let i = 0; i < 25; i++) addBreadcrumb(`step ${i}`);
    captureException(new Error('x'));
    expect(sent[0]?.breadcrumbs?.map((crumb) => crumb.message)[0]).toBe('step 5');
    clearBreadcrumbs();
    captureException(new Error('y'));
    expect(sent[1]?.breadcrumbs).toBeUndefined();
  });

  it('records nothing automatically: logs below error never become breadcrumbs', () => {
    setCrashTransport((event) => {
      sent.push(event);
    });
    log.info('Tapped a song');
    log.warn('Slow network');
    captureException(new Error('x'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.breadcrumbs).toBeUndefined();
  });

  it('reports logged errors while a transport is set, and stops when it is removed', () => {
    setCrashTransport((event) => {
      sent.push(event);
    });
    log.child('room').error('Join failed for a@b.io', new Error('QD-7K4F9X expired'));
    setCrashTransport(null);
    log.error('after removal', new Error('ignored'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        message: '[room] Join failed for [email]',
        error: expect.objectContaining({ message: '[room-code] expired' }),
      }),
    );
  });

  it('replacing the transport does not report twice', () => {
    const first = jest.fn();
    const second = jest.fn();
    setCrashTransport(first);
    setCrashTransport(second);
    log.error('once');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('survives a transport that throws or rejects', async () => {
    setCrashTransport(() => {
      throw new Error('offline');
    });
    expect(() => captureException(new Error('x'))).not.toThrow();
    setCrashTransport(() => Promise.reject(new Error('offline')));
    expect(() => captureException(new Error('x'))).not.toThrow();
    await Promise.resolve();
  });

  it('forgets breadcrumbs when the transport is removed', () => {
    setCrashTransport(() => {});
    addBreadcrumb('before');
    setCrashTransport(null);
    setCrashTransport((event) => {
      sent.push(event);
    });
    captureException(new Error('x'));
    expect(sent[0]?.breadcrumbs).toBeUndefined();
  });
});

describe('installGlobalErrorHandler', () => {
  afterEach(() => setCrashTransport(null));

  function fakeErrorUtils() {
    let handler = jest.fn();
    return {
      previous: handler,
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: jest.Mock) => {
        handler = next;
      },
      current: () => handler,
    };
  }

  it('reports uncaught errors and then calls the previous handler', () => {
    const sent: CrashEvent[] = [];
    setCrashTransport((event) => {
      sent.push(event);
    });
    const utils = fakeErrorUtils();
    const uninstall = installGlobalErrorHandler(utils);
    const error = new Error('fatal in QD-7K4F9X');
    utils.current()(error, true);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        level: 'fatal',
        message: 'fatal in [room-code]',
        context: { fatal: true },
      }),
    );
    expect(utils.previous).toHaveBeenCalledWith(error, true);
    uninstall();
    expect(utils.current()).toBe(utils.previous);
  });

  it('reports non-fatal errors as errors', () => {
    const sent: CrashEvent[] = [];
    setCrashTransport((event) => {
      sent.push(event);
    });
    const utils = fakeErrorUtils();
    installGlobalErrorHandler(utils);
    utils.current()(new Error('x'));
    expect(sent[0]?.level).toBe('error');
  });

  it('does nothing where ErrorUtils is missing', () => {
    expect(() => installGlobalErrorHandler(undefined)()).not.toThrow();
  });
});
