import {
  idlePalette,
  neutralPlayingPalette,
  paletteFromArtworkColor,
  type NowPlayingPalette,
} from '@/design';
import type { MusicProvider } from '@/domain/music-provider';
import type { MockRoom } from '@/providers/mock/data';

/**
 * The Now playing palette for a song, following the provider artwork rules
 * (plan.md §3): Apple Music's supplied artwork color may set the colors;
 * Spotify songs get provider-neutral colors.
 */
export function songPalette(
  playsThrough: MusicProvider,
  artworkColor: string | null | undefined,
): NowPlayingPalette {
  if (playsThrough === 'apple_music' && artworkColor) {
    return paletteFromArtworkColor(artworkColor);
  }
  return neutralPlayingPalette;
}

/** A room's palette: its now-playing song's, or idle with nothing playing. */
export function roomPalette(
  room: Pick<MockRoom, 'nowPlaying' | 'playsThrough'> | null,
): NowPlayingPalette {
  if (!room?.nowPlaying) return idlePalette;
  return songPalette(room.playsThrough, room.nowPlaying.artworkColor);
}
