import { noticeContent } from './HostNotice';

const reconnecting = { kind: 'reconnecting', awayMs: 12_000, remainingMs: 18_000 } as const;
const away = { kind: 'away', awayMs: 40_000 } as const;
const connected = { kind: 'connected' } as const;

const content = (
  host: Parameters<typeof noticeContent>[0]['host'],
  pausedForHost: boolean,
  isHost: boolean,
) => noticeContent({ host, pausedForHost, isHost, hostName: 'Baron' });

// Every state of the host notice (PRODUCT_SPEC.md §4), for both sides.
describe('noticeContent', () => {
  it('says nothing while the host is in the room and nothing paused', () => {
    expect(content(connected, false, false)).toBeNull();
    expect(content(connected, false, true)).toBeNull();
  });

  it('counts down for listeners while the host reconnects', () => {
    expect(content(reconnecting, false, false)).toEqual({
      title: 'Host reconnecting',
      body: 'Baron’s phone plays the music and lost the room. If it isn’t back in 18 s, the music pauses. The queue is kept.',
      tone: 'warn',
      resume: false,
    });
  });

  it('counts down on the host’s own phone, without Resume', () => {
    expect(content(reconnecting, false, true)).toMatchObject({
      title: 'Reconnecting',
      tone: 'warn',
      resume: false,
    });
  });

  it('says the music paused once the grace period is over, with the room kept', () => {
    expect(content(away, true, false)).toMatchObject({ title: 'Paused', resume: false });
    expect(content(away, true, false)?.body).toContain('The room and the queue are kept.');
    expect(content(away, true, true)).toMatchObject({
      title: 'Paused · you’re offline',
      resume: false,
    });
  });

  it('shows "away" even before the store records the pause', () => {
    expect(content(away, false, false)?.title).toBe('Paused');
  });

  it('offers Resume only to the returning host', () => {
    expect(content(connected, true, true)).toMatchObject({
      title: 'You’re back',
      tone: 'ok',
      resume: true,
    });
    expect(content(connected, true, false)).toEqual({
      title: 'Paused',
      body: 'Baron is back. The music starts again when they resume it.',
      tone: 'ok',
      resume: false,
    });
  });

  it('never offers Resume while the host is still away', () => {
    for (const host of [reconnecting, away]) {
      for (const isHost of [true, false]) {
        expect(content(host, true, isHost)?.resume).toBe(false);
      }
    }
  });
});
