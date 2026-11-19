/**
 * Fixed colors from the Figma page `20 · Mobile` ("Neutral" variables).
 * Cover-dependent colors (accent, glows) live in `nowPlaying.ts`.
 */
export const neutral = {
  bg: '#000000',
  text: '#f5f1eb',
  text2: '#f5f1eba8',
  text3: '#f5f1eb6b',
  surface: '#ffffff0f',
  surfaceRaised: '#ffffff1c',
  stroke: '#ffffff17',
  strokeStrong: '#ffffff33',
  sheetGlass: '#151413d1',
  statusOk: '#5cd89a',
  okSoft: '#5cd89a24',
  okLine: '#5cd89a73',
  statusWarn: '#f4b740',
  warnSoft: '#f4b74024',
  /** Glass icon button fill (Figma: rgba(0,0,0,0.45)). */
  glassFill: '#00000073',
  /** Text on an avatar's user color. */
  onAvatar: '#1a1410',
} as const;

/**
 * Provider brand colors from Figma. YouTube Music exists in the design file
 * but is not a supported provider (plan.md §2), so it is intentionally absent.
 */
export const providerColors = {
  spotify: { solid: '#1db954', tint: '#1db95429' },
  apple_music: { solid: '#fa2d48', tint: '#fa2d4829' },
} as const;

/** Default avatar color from the Figma Avatar component. */
export const defaultAvatarColor = '#f2a27c';

export type NeutralColors = typeof neutral;
