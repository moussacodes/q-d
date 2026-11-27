import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { previewPalettes, ThemeProvider } from '@/design';

import { MatchNotice, VersionPickedNotice } from './MatchNotice';

type Props = ComponentProps<typeof MatchNotice>;

const renderNotice = async (props: Partial<Props> & Pick<Props, 'availability'>) => {
  const onSkip = jest.fn();
  await render(
    <ThemeProvider initialPalette={previewPalettes.sonOfSpergy}>
      <MatchNotice playsThrough="spotify" isHost onSkip={onSkip} {...props} />
    </ThemeProvider>,
  );
  return { onSkip };
};

// The states mock mode can't reach through the room screen: a song with no
// stored match yet, and the "Wrong version?" slot the override card fills.
describe('MatchNotice', () => {
  it('tells the host a song with no match yet won’t play, and offers Skip', async () => {
    const { onSkip } = await renderNotice({ availability: { kind: 'unknown' } });
    expect(await screen.findByText('Not matched on Spotify yet')).toBeVisible();
    expect(
      screen.getByText(
        'Your phone won’t play this song until q’d finds it on Spotify. Skip it to keep the room going.',
      ),
    ).toBeVisible();
    fireEvent.press(screen.getByLabelText('Skip this song'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('tells listeners the same, without Skip', async () => {
    await renderNotice({
      availability: { kind: 'unknown' },
      isHost: false,
      playsThrough: 'apple_music',
    });
    expect(await screen.findByText('Not matched on Apple Music yet')).toBeVisible();
    expect(
      screen.getByText(
        'The host’s phone won’t play this song until q’d finds it on Apple Music. The host can skip it.',
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Skip this song')).toBeNull();
  });

  it('rounds the confidence it shows', async () => {
    await renderNotice({
      availability: { kind: 'uncertain', warning: 'low_confidence', confidence: 80.6 },
    });
    expect(await screen.findByText(/\(81\/100 match\)/)).toBeVisible();
  });

  const uncertain = { kind: 'uncertain', warning: 'low_confidence', confidence: 81 } as const;

  it('hides “Wrong version?” when the room doesn’t pass it', async () => {
    await renderNotice({ availability: uncertain });
    expect(await screen.findByText('Might be a different version')).toBeVisible();
    expect(screen.queryByText('Wrong version?')).toBeNull();
  });

  it('offers “Wrong version?” to the host once it’s passed', async () => {
    const onWrongVersion = jest.fn();
    await renderNotice({ availability: uncertain, onWrongVersion });
    fireEvent.press(await screen.findByText('Wrong version?'));
    expect(onWrongVersion).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Wrong version? Pick the right one')).toHaveProp(
      'accessibilityRole',
      'button',
    );
  });

  it('shows “Wrong version?” turned off with the note when only a note is passed (live rooms)', async () => {
    await renderNotice({ availability: uncertain, wrongVersionNote: 'Not connected here yet.' });
    expect(await screen.findByLabelText('Wrong version? Pick the right one')).toBeDisabled();
    expect(screen.getByText('Not connected here yet.')).toBeVisible();
  });

  it('drops the note once the room passes a working “Wrong version?”', async () => {
    await renderNotice({
      availability: uncertain,
      onWrongVersion: jest.fn(),
      wrongVersionNote: 'Not connected here yet.',
    });
    expect(await screen.findByLabelText('Wrong version? Pick the right one')).toBeEnabled();
    expect(screen.queryByText('Not connected here yet.')).toBeNull();
  });

  it('never shows the note to listeners or for an unmatched song', async () => {
    await renderNotice({ availability: uncertain, isHost: false, wrongVersionNote: 'Note.' });
    expect(screen.queryByText('Note.')).toBeNull();
    expect(screen.queryByText('Wrong version?')).toBeNull();
  });

  it('never offers “Wrong version?” for a song with no match', async () => {
    await renderNotice({ availability: { kind: 'unknown' }, onWrongVersion: jest.fn() });
    expect(await screen.findByText('Not matched on Spotify yet')).toBeVisible();
    expect(screen.queryByText('Wrong version?')).toBeNull();
  });

  it('never offers “Wrong version?” or Skip to listeners', async () => {
    await renderNotice({
      availability: { kind: 'uncertain', warning: 'explicit_conflict', confidence: 95 },
      isHost: false,
      onWrongVersion: jest.fn(),
    });
    expect(await screen.findByText('Explicit/clean version differs')).toBeVisible();
    expect(screen.queryByText('Wrong version?')).toBeNull();
    expect(screen.queryByLabelText('Skip this song')).toBeNull();
  });
});

describe('VersionPickedNotice', () => {
  const renderPicked = async (props: Partial<ComponentProps<typeof VersionPickedNotice>>) => {
    await render(
      <ThemeProvider initialPalette={previewPalettes.sonOfSpergy}>
        <VersionPickedNotice playsThrough="spotify" isHost {...props} />
      </ThemeProvider>,
    );
  };

  it('tells the host the pick is saved and plays from next time, never mid-song', async () => {
    const onPickAgain = jest.fn();
    await renderPicked({ onPickAgain });
    expect(await screen.findByText('You picked a different version')).toBeVisible();
    expect(
      screen.getByText(
        'This play finishes as it started. Your pick plays on Spotify from the next time this song comes up.',
      ),
    ).toBeVisible();
    fireEvent.press(screen.getByLabelText('Change the version you picked'));
    expect(onPickAgain).toHaveBeenCalledTimes(1);
  });

  it('names the room’s service', async () => {
    await renderPicked({ playsThrough: 'apple_music' });
    expect(await screen.findByText(/Your pick plays on Apple Music/)).toBeVisible();
  });

  it('hides “Change pick” without a handler', async () => {
    await renderPicked({});
    expect(await screen.findByText('You picked a different version')).toBeVisible();
    expect(screen.queryByLabelText('Change the version you picked')).toBeNull();
  });

  it('tells listeners plainly, with nothing to press', async () => {
    await renderPicked({ isHost: false, onPickAgain: jest.fn() });
    expect(await screen.findByText('The host picked a different version')).toBeVisible();
    expect(
      screen.getByText(
        'This play finishes as it started. The host’s pick plays from the next time this song comes up.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
