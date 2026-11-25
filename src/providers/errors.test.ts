import { isProviderError, ProviderError } from './errors';

describe('ProviderError', () => {
  it('carries a code and a provider', () => {
    const error = new ProviderError('not_found', 'spotify');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderError');
    expect(error.code).toBe('not_found');
    expect(error.provider).toBe('spotify');
    expect(error.message).toBe('not_found');
  });

  it('keeps a developer message', () => {
    expect(new ProviderError('wrong_provider', 'apple_music', 'Other provider').message).toBe(
      'Other provider',
    );
  });

  it('is told apart from other errors', () => {
    expect(isProviderError(new ProviderError('not_found', 'spotify'))).toBe(true);
    expect(isProviderError(new Error('not_found'))).toBe(false);
    expect(isProviderError({ code: 'not_found' })).toBe(false);
    expect(isProviderError(null)).toBe(false);
  });
});

describe('ProviderError retry time', () => {
  it('carries how long to wait after rate_limited', () => {
    const error = new ProviderError('rate_limited', 'apple_music', 'slow down', 12);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(12);
    expect(new ProviderError('not_found', 'spotify').retryAfterSeconds).toBeUndefined();
  });
});
