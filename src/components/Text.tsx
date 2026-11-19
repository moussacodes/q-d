import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typography, useTheme, type ThemeColors, type TypographyVariant } from '@/design';

type ColorToken = Extract<
  keyof ThemeColors,
  'text' | 'text2' | 'text3' | 'accent' | 'onAccent' | 'statusOk' | 'statusWarn'
>;

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  /** A theme color name, or any color string. Defaults to `text`. */
  color?: ColorToken | (string & {});
};

/** Text in one of the Figma "Mobile/…" styles. */
export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const resolved = color in colors ? colors[color as ColorToken] : color;
  return <RNText {...rest} style={[typography[variant], { color: resolved }, style]} />;
}
