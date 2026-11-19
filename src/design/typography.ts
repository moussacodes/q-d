import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import type { TextStyle } from 'react-native';

/**
 * Geist and Geist Mono (SIL Open Font License), as used in Figma `20 · Mobile`.
 * Each weight is its own family name so Android and iOS pick the same file.
 */
export const fontAssets = {
  'Geist-Regular': Geist_400Regular,
  'Geist-Medium': Geist_500Medium,
  'Geist-SemiBold': Geist_600SemiBold,
  'Geist-Bold': Geist_700Bold,
  'GeistMono-Regular': GeistMono_400Regular,
  'GeistMono-Medium': GeistMono_500Medium,
};

export const fonts = {
  regular: 'Geist-Regular',
  medium: 'Geist-Medium',
  semiBold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
  monoRegular: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
} as const;

/** Figma letter spacing is a percentage of the font size. */
const tracking = (fontSize: number, percent: number) => (fontSize * percent) / 100;

const style = (
  fontFamily: string,
  fontSize: number,
  lineHeight: number | undefined,
  letterSpacingPercent = 0,
): TextStyle => ({
  fontFamily,
  fontSize,
  ...(lineHeight === undefined ? {} : { lineHeight }),
  ...(letterSpacingPercent === 0 ? {} : { letterSpacing: tracking(fontSize, letterSpacingPercent) }),
});

/** Text styles named after the Figma "Mobile/…" styles. */
export const typography = {
  hero: style(fonts.semiBold, 36, 40, -3),
  display: style(fonts.semiBold, 32, 34, -3),
  title: style(fonts.semiBold, 24, 28, -2),
  heading: style(fonts.semiBold, 20, 24, -1),
  subhead: style(fonts.semiBold, 16, 20),
  body: style(fonts.regular, 15, 22),
  bodyStrong: style(fonts.semiBold, 15, 20),
  button: style(fonts.semiBold, 15, 20),
  buttonSmall: style(fonts.semiBold, 13, 16),
  callout: style(fonts.regular, 14, 20),
  label: style(fonts.medium, 13, 16),
  footnote: style(fonts.regular, 13, 18),
  caption: style(fonts.regular, 12, 16),
  labelSmall: style(fonts.medium, 11, 14),
  eyebrow: { ...style(fonts.monoMedium, 11, 14, 6), textTransform: 'uppercase' },
  mono: style(fonts.monoRegular, 13, 16),
  monoSmall: style(fonts.monoRegular, 11, 14),
  logo: style(fonts.bold, 22, undefined, -4),
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
