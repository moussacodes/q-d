import { formatDuration, parseDuration } from './time';

describe('durations', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatDuration(225_000)).toBe('3:45');
    expect(formatDuration(5_999)).toBe('0:05');
    expect(formatDuration(-1)).toBe('0:00');
  });

  it('parses m:ss into milliseconds', () => {
    expect(parseDuration('3:45')).toBe(225_000);
    expect(parseDuration('0:07')).toBe(7_000);
  });
});
