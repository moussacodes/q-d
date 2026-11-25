import { parseProviderLink } from './links';

const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';

describe('parseProviderLink', () => {
  it.each([
    [`https://open.spotify.com/track/${SPOTIFY_ID}`, 'spotify', 'track', SPOTIFY_ID],
    [`https://open.spotify.com/track/${SPOTIFY_ID}?si=abc123`, 'spotify', 'track', SPOTIFY_ID],
    [`https://open.spotify.com/intl-de/track/${SPOTIFY_ID}`, 'spotify', 'track', SPOTIFY_ID],
    [`https://open.spotify.com/playlist/${SPOTIFY_ID}`, 'spotify', 'playlist', SPOTIFY_ID],
    [`https://OPEN.SPOTIFY.COM/track/${SPOTIFY_ID}`, 'spotify', 'track', SPOTIFY_ID],
    [`spotify:track:${SPOTIFY_ID}`, 'spotify', 'track', SPOTIFY_ID],
    [`spotify:playlist:${SPOTIFY_ID}`, 'spotify', 'playlist', SPOTIFY_ID],
    [`  https://open.spotify.com/track/${SPOTIFY_ID}  `, 'spotify', 'track', SPOTIFY_ID],
    ['https://music.apple.com/us/song/rain-down/1440857781', 'apple_music', 'track', '1440857781'],
    ['https://music.apple.com/us/song/1440857781', 'apple_music', 'track', '1440857781'],
    [
      'https://music.apple.com/us/album/never-enough/1440857000?i=1440857781',
      'apple_music',
      'track',
      '1440857781',
    ],
    [
      'https://music.apple.com/gb/album/never-enough/1440857000?l=en&i=1440857781#x',
      'apple_music',
      'track',
      '1440857781',
    ],
    [
      'https://music.apple.com/us/playlist/road-trip/pl.u-abc123-XYZ',
      'apple_music',
      'playlist',
      'pl.u-abc123-XYZ',
    ],
  ])('reads %s', (url, provider, kind, id) => {
    expect(parseProviderLink(url)).toEqual({ provider, kind, id });
  });

  it.each([
    ['an empty string', ''],
    ['plain text', 'rain down daniel caesar'],
    ['plain http', `http://open.spotify.com/track/${SPOTIFY_ID}`],
    ['another site', `https://example.com/track/${SPOTIFY_ID}`],
    ['a look-alike host', `https://open.spotify.com.evil.example/track/${SPOTIFY_ID}`],
    ['YouTube Music', 'https://music.youtube.com/watch?v=abc'],
    ['TIDAL', 'https://tidal.com/browse/track/12345'],
    ['a Spotify album', `https://open.spotify.com/album/${SPOTIFY_ID}`],
    ['a Spotify artist', `https://open.spotify.com/artist/${SPOTIFY_ID}`],
    ['a short Spotify id', 'https://open.spotify.com/track/abc'],
    ['an extra path segment', `https://open.spotify.com/track/${SPOTIFY_ID}/extra`],
    ['a Spotify URI with extra parts', `spotify:track:${SPOTIFY_ID}:more`],
    ['a Spotify user URI', 'spotify:user:someone'],
    ['an Apple album without a song', 'https://music.apple.com/us/album/never-enough/1440857000'],
    ['an Apple song with a bad id', 'https://music.apple.com/us/song/rain-down/abc'],
    ['an Apple artist', 'https://music.apple.com/us/artist/daniel-caesar/1000'],
    ['an Apple playlist with a bad id', 'https://music.apple.com/us/playlist/road-trip/123'],
  ])('rejects %s', (_name, url) => {
    expect(parseProviderLink(url)).toBeNull();
  });
});
