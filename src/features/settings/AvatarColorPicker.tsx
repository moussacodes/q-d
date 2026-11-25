import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/design';
import { avatarColors } from '@/providers/mock/data';

/**
 * The avatar colors from onboarding step 1 (same swatches and ring), for
 * Settings → Account. One is always selected; picking another saves it.
 */
export function AvatarColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup">
      {avatarColors.map((swatch, index) => {
        const selected = swatch === value;
        return (
          <Pressable
            key={swatch}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Color ${index + 1} of ${avatarColors.length}`}
            onPress={() => onChange(swatch)}
            style={[styles.ring, selected && { borderColor: colors.text }]}
          >
            <View style={[styles.swatch, { backgroundColor: swatch }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ring: { borderRadius: 20, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
});
