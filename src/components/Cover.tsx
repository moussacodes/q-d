import { Image, type ImageSource } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/design';

import { Icon } from './Icon';

type CoverProps = {
  /**
   * Artwork from the music provider. Without one, a neutral placeholder is
   * shown. The design file's sample covers are real albums and are not
   * bundled with the app.
   */
  source?: ImageSource | string | null;
  size: number;
  radius?: number;
};

/** Album artwork (Figma "Cover"). */
export function Cover({ source, size, radius = 10 }: CoverProps) {
  const { colors } = useTheme();
  const frame = { width: size, height: size, borderRadius: radius };
  if (!source) {
    return (
      <View style={[styles.placeholder, frame, { backgroundColor: colors.surfaceRaised }]}>
        <Icon name="music" size={Math.round(size * 0.4)} color={colors.text3} />
      </View>
    );
  }
  return (
    <Image
      source={source}
      style={[styles.image, frame]}
      contentFit="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { overflow: 'hidden' },
});
