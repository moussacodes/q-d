import { Pressable, StyleSheet, View } from 'react-native';

import { defaultAvatarColor, neutral, providerColors, radii, useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';

import { Text } from './Text';

/** The q’d wordmark with its accent dot (Figma "Logo"). Pass `dot={false}` for the bare wordmark. */
export function Logo({ dot = true }: { dot?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="q’d">
      <Text variant="logo">q’d</Text>
      {dot ? <View style={[styles.logoDot, { backgroundColor: colors.accent }]} /> : null}
    </View>
  );
}

type AvatarProps = {
  initial: string;
  /** The color the user picked during onboarding. */
  color?: string;
  /** 28 (default) or 40 in listener rows. */
  size?: number;
};

export function Avatar({ initial, color = defaultAvatarColor, size = 28 }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Text variant="labelSmall" color={neutral.onAvatar} style={styles.avatarText}>
        {initial}
      </Text>
    </View>
  );
}

type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
};

/** 48 × 28 switch (Figma "Toggle"). */
export function Toggle({ value, onValueChange, accessibilityLabel, disabled }: ToggleProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      style={[
        styles.toggle,
        { backgroundColor: value ? colors.accent : colors.surfaceRaised },
        disabled && styles.disabled,
      ]}
    >
      <View
        style={[
          styles.knob,
          value
            ? { left: 23, backgroundColor: colors.onAccent }
            : { left: 3, backgroundColor: colors.text },
        ]}
      />
    </Pressable>
  );
}

type SegmentedControlProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Full-width track with equal segments (Settings tabs). */
  fill?: boolean;
};

/** A row of Figma "Segment" options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill,
}: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.segments,
        fill && [
          styles.segmentsFill,
          { backgroundColor: colors.surface, borderColor: colors.stroke },
        ],
      ]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              fill && styles.segmentFill,
              selected && { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Text variant="label" color={selected ? 'text' : 'text2'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Provider dot + name (Figma "Provider Badge"). */
export function ProviderBadge({ provider }: { provider: MusicProvider }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.surface }]}>
      <View style={[styles.badgeDot, { backgroundColor: providerColors[provider].solid }]} />
      <Text variant="labelSmall" color="text2">
        {providerNames[provider]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  logoDot: { width: 6, height: 6, borderRadius: 3 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Geist-SemiBold' },
  toggle: { width: 48, height: 28, borderRadius: 14 },
  knob: { position: 'absolute', top: 3, width: 22, height: 22, borderRadius: 11 },
  disabled: { opacity: 0.4 },
  segments: { flexDirection: 'row', gap: 12 },
  segmentsFill: { gap: 0, padding: 3, borderRadius: 12, borderWidth: 1 },
  segmentFill: { flex: 1 },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 7,
    paddingRight: 9,
    paddingVertical: 4,
    borderRadius: radii.badge,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 3.5 },
});
