import type { MusicProvider } from '@/domain/music-provider';

import type { ProviderErrorCode } from './types';

/**
 * The one error type adapters throw. The UI maps `code` to copy; `message` is
 * for developers and never contains tokens, emails or listening history.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: MusicProvider,
    message: string = code,
  ) {
    super(message);
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
