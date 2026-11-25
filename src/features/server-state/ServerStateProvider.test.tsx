import { useQuery, useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { createQueryClient, queryClient } from '@/services/queryClient';

import { ServerStateProvider } from './ServerStateProvider';

jest.mock('expo-sqlite/localStorage/install', () => {});

function Probe({ expected }: { expected: unknown }) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: ['probe'], queryFn: async () => 'loaded' });
  return (
    <Text>
      {client === expected ? 'same client' : 'other client'} · {data ?? 'loading'}
    </Text>
  );
}

describe('ServerStateProvider', () => {
  it('provides the app query client by default', async () => {
    await render(
      <ServerStateProvider>
        <Probe expected={queryClient} />
      </ServerStateProvider>,
    );
    expect(await screen.findByText('same client · loaded')).toBeTruthy();
    queryClient.clear();
  });

  it('accepts a client, e.g. a fresh one per test', async () => {
    const client = createQueryClient();
    const { unmount } = await render(
      <ServerStateProvider client={client}>
        <Probe expected={client} />
      </ServerStateProvider>,
    );
    expect(await screen.findByText('same client · loaded')).toBeTruthy();
    await unmount();
    client.clear();
  });
});
