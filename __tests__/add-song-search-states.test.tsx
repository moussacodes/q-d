import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Add a song while search fails or is slow (canonical search card): the sheet
// shows plain copy, never a raw error, and never "No songs match" for a search
// that didn't answer. The catalog is the labeled mock, except for a few
// queries this test makes fail or hang.
jest.setTimeout(60_000);

jest.mock('@/providers', () => {
  const actual = jest.requireActual('@/providers');
  const { ProviderError: Failure } = jest.requireActual('@/providers/errors');
  return {
    ...actual,
    catalog: {
      ...actual.catalog,
      provider: actual.catalog.provider,
      search(query: string, market: string) {
        if (query === 'too many') {
          return Promise.reject(new Failure('rate_limited', 'apple_music', 'x', 12));
        }
        if (query === 'broken') {
          return Promise.reject(new Failure('provider_unavailable', 'apple_music'));
        }
        if (query === 'crash') return Promise.reject(new Error('raw internal detail'));
        if (query === 'slow') return new Promise(() => {});
        return actual.catalog.search(query, market);
      },
    },
  };
});

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const type = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByDisplayValue(/.*/), text);
  });
};

const openAddSong = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push({ pathname: '/room/[code]', params: { code: 'QD-9M2XR4' } });
  });
  await press('Add a song');
  await screen.findByText('Rain Down');
};

describe('Add a song when search fails', () => {
  it('says when to try again after too many searches, and shows no results', async () => {
    await openAddSong();
    await type('too many');
    expect(await screen.findByText('Too many searches. Try again in 12 seconds.')).toBeVisible();
    expect(screen.queryByText('Rain Down')).toBeNull();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });

  it('says search is not working when the service is unavailable', async () => {
    await openAddSong();
    await type('broken');
    expect(
      await screen.findByText('Search isn’t working right now. Try again in a moment.'),
    ).toBeVisible();
  });

  it('never shows a raw error', async () => {
    await openAddSong();
    await type('crash');
    expect(
      await screen.findByText('Search isn’t working right now. Try again in a moment.'),
    ).toBeVisible();
    expect(screen.queryByText(/raw internal detail/)).toBeNull();
  });

  it('recovers when the next search works', async () => {
    await openAddSong();
    await type('broken');
    await screen.findByText('Search isn’t working right now. Try again in a moment.');
    await type('daniel caesar');
    expect(await screen.findByText('Rain Down')).toBeVisible();
    expect(screen.queryByText(/Search isn’t working/)).toBeNull();
  });
});

describe('Add a song while a search is slow', () => {
  it('keeps the last results instead of flashing "No songs match"', async () => {
    await openAddSong();
    await type('slow');
    expect(screen.getByText('Rain Down')).toBeVisible();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });

  it('says "Searching…", not the old error, when there are no results to keep', async () => {
    await openAddSong();
    await type('broken');
    await screen.findByText('Search isn’t working right now. Try again in a moment.');
    await type('slow');
    expect(await screen.findByText('Searching…')).toBeVisible();
    expect(screen.queryByText(/Search isn’t working/)).toBeNull();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });
});
