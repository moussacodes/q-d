import {
  callbackErrorCode,
  loggableReason,
  parseAuthCallbackParams,
  parseAuthCallbackUrl,
} from './auth';

describe('parseAuthCallbackUrl', () => {
  it.each([
    ['qd://auth/callback?code=abc', { kind: 'code', code: 'abc' }],
    ['exp://192.168.1.2:8081/--/auth/callback?code=abc', { kind: 'code', code: 'abc' }],
    ['qd://auth/callback#code=abc', { kind: 'code', code: 'abc' }],
    ['qd://auth/callback?code=', { kind: 'missing' }],
    ['qd://auth/callback', { kind: 'missing' }],
    ['qd://auth/callback?state=x', { kind: 'missing' }],
    [
      'qd://auth/callback?error=access_denied&error_description=No',
      { kind: 'error', error: 'access_denied', errorCode: null },
    ],
    [
      'qd://auth/callback#error=access_denied&error_code=otp_expired&error_description=Expired',
      { kind: 'error', error: 'access_denied', errorCode: 'otp_expired' },
    ],
    [
      'qd://auth/callback?code=abc&error=server_error',
      { kind: 'error', error: 'server_error', errorCode: null },
    ],
  ])('%s', (url, expected) => {
    expect(parseAuthCallbackUrl(url)).toEqual(expected);
  });
});

describe('parseAuthCallbackParams', () => {
  it('reads route params, including repeated ones', () => {
    expect(parseAuthCallbackParams({ code: ['abc', 'def'] })).toEqual({
      kind: 'code',
      code: 'abc',
    });
    expect(parseAuthCallbackParams({ error_code: 'flow_state_expired' })).toEqual({
      kind: 'error',
      error: 'flow_state_expired',
      errorCode: 'flow_state_expired',
    });
    expect(parseAuthCallbackParams({ code: '  ' })).toEqual({ kind: 'missing' });
    expect(parseAuthCallbackParams({})).toEqual({ kind: 'missing' });
  });
});

describe('callbackErrorCode', () => {
  it.each([
    ['access_denied', null, 'cancelled'],
    ['access_denied', 'access_denied', 'cancelled'],
    ['access_denied', 'otp_expired', 'link_expired'],
    ['invalid_request', 'flow_state_expired', 'link_expired'],
    ['invalid_request', 'bad_oauth_state', 'link_invalid'],
    ['invalid_request', 'provider_disabled', 'method_unavailable'],
    ['access_denied', 'signup_disabled', 'signups_disabled'],
    ['too_many', 'over_request_rate_limit', 'rate_limited'],
    ['server_error', null, 'unknown'],
    ['temporarily_unavailable', null, 'unknown'],
    ['something_new', null, 'link_invalid'],
  ] as const)('%s / %s → %s', (error, errorCode, expected) => {
    expect(callbackErrorCode(error, errorCode)).toBe(expected);
  });
});

describe('loggableReason', () => {
  it('passes short machine codes and nothing else', () => {
    expect(loggableReason('otp_expired')).toBe('otp_expired');
    expect(loggableReason('access_denied')).toBe('access_denied');
    expect(loggableReason(null)).toBeNull();
    expect(loggableReason(undefined)).toBeNull();
    expect(loggableReason('someone@example.com')).toBe('other');
    expect(loggableReason('Email link is invalid')).toBe('other');
    expect(loggableReason('a'.repeat(65))).toBe('other');
    expect(loggableReason('')).toBe('other');
  });
});
