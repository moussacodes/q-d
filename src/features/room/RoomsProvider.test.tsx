import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { forgetLiveInvites } from './liveRoom';
import { RoomsProvider } from './useRoom';

// Server state belongs to the account that read it (docs/DECISIONS.md, "Live
// room screens"): when the account changes, the cached rooms and the invite
// tokens this phone kept are gone.

let mockAccountId: string | null = 'account-a';

jest.mock('@/features/session/MockSession', () => ({
  ...jest.requireActual('@/features/session/MockSession'),
  useMockSession: () => ({ accountId: mockAccountId }),
}));

jest.mock('./liveRoom', () => ({
  ...jest.requireActual('./liveRoom'),
  forgetLiveInvites: jest.fn(),
}));

function tree(client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <RoomsProvider>{null}</RoomsProvider>
    </QueryClientProvider>
  );
}

describe('RoomsProvider', () => {
  it('drops the last account’s rooms and invite tokens when the account changes', async () => {
    const client = new QueryClient();
    const view = await render(tree(client));
    jest.mocked(forgetLiveInvites).mockClear();
    client.setQueryData(['room', 'room-1', 'detail'], { name: 'Late Night Live' });
    client.setQueryData(['rooms', 'mine'], [{ id: 'room-1' }]);

    // Same account: nothing is dropped.
    await view.rerender(tree(client));
    expect(client.getQueryData(['rooms', 'mine'])).toBeDefined();
    expect(forgetLiveInvites).not.toHaveBeenCalled();

    // Signed out, then someone else signs in.
    mockAccountId = null;
    await view.rerender(tree(client));
    expect(client.getQueryData(['rooms', 'mine'])).toBeUndefined();
    expect(client.getQueryData(['room', 'room-1', 'detail'])).toBeUndefined();
    expect(forgetLiveInvites).toHaveBeenCalledTimes(1);

    client.setQueryData(['rooms', 'mine'], [{ id: 'room-1' }]);
    mockAccountId = 'account-b';
    await view.rerender(tree(client));
    expect(client.getQueryData(['rooms', 'mine'])).toBeUndefined();
    expect(forgetLiveInvites).toHaveBeenCalledTimes(2);
  });
});
