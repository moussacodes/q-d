import { idlePalette, neutralPlayingPalette, paletteFromArtworkColor } from '@/design';
import { mockNowPlaying } from '@/providers/mock/data';

import { roomPalette, songPalette } from './palette';

describe('Now playing palette by provider', () => {
  it('uses Apple Music’s supplied artwork color', () => {
    expect(songPalette('apple_music', '#1f3ac4')).toBe(paletteFromArtworkColor('#1f3ac4'));
  });

  it('gives Spotify songs the provider-neutral palette, whatever the artwork', () => {
    expect(songPalette('spotify', '#1f3ac4')).toBe(neutralPlayingPalette);
  });

  it('falls back to neutral when Apple supplies no color', () => {
    expect(songPalette('apple_music', null)).toBe(neutralPlayingPalette);
  });

  it('is idle with nothing playing', () => {
    expect(roomPalette(null)).toBe(idlePalette);
    expect(roomPalette({ nowPlaying: null, playsThrough: 'apple_music' })).toBe(idlePalette);
  });

  it('follows the service the room plays through', () => {
    const apple = roomPalette({ nowPlaying: mockNowPlaying, playsThrough: 'apple_music' });
    const spotify = roomPalette({ nowPlaying: mockNowPlaying, playsThrough: 'spotify' });
    expect(apple).toBe(paletteFromArtworkColor(mockNowPlaying.artworkColor));
    expect(spotify).toBe(neutralPlayingPalette);
  });
});
