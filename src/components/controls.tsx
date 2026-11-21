import { BlurView } from 'expo-blur';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';

import { radii, typography, useTheme } from '@/design';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  kind?: 'primary' | 'secondary' | 'ghost';
  size?: 'large' | 'small';
  icon?: IconName;
  /** Stretch to the parent's width. */
  block?: boolean;
};

/** Figma "Button": Primary / Secondary / Ghost, large (52) or small (36). */
export function Button({
  label,
  kind = 'primary',
  size = 'large',
  icon,
  block,
  disabled,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const large = size === 'large';
  const background =
    kind === 'primary' ? colors.accent : kind === 'secondary' ? colors.surfaceRaised : undefined;
  const foreground = kind === 'primary' ? colors.onAccent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        large ? styles.buttonLarge : styles.buttonSmall,
        { backgroundColor: background },
        block && styles.block,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={large ? 20 : 16} color={foreground} /> : null}
      <Text variant={large ? 'button' : 'buttonSmall'} color={foreground}>
        {label}
      </Text>
    </Pressable>
  );
}

type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: IconName;
  accessibilityLabel: string;
  kind?: 'surface' | 'accent' | 'glass';
};

/** Figma "Icon Button": 40 pt circle. Glass sits on top of artwork. */
export function IconButton({ icon, kind = 'surface', disabled, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.iconButton,
        kind === 'accent' && { backgroundColor: colors.accent },
        kind === 'surface' && { backgroundColor: colors.surfaceRaised },
        kind === 'glass' && [
          styles.glass,
          { backgroundColor: colors.glassFill, borderColor: colors.strokeStrong },
        ],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {kind === 'glass' ? (
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <Icon name={icon} size={20} color={kind === 'accent' ? colors.onAccent : colors.text} />
    </Pressable>
  );
}

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn';

type ChipProps = {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
};

/** Figma "Chip": small status pill. */
export function Chip({ label, tone = 'neutral', icon }: ChipProps) {
  const { colors } = useTheme();
  const tones: Record<ChipTone, { background: string; foreground: string }> = {
    neutral: { background: colors.surface, foreground: colors.text2 },
    accent: { background: colors.accentSoft, foreground: colors.accent },
    ok: { background: colors.okSoft, foreground: colors.statusOk },
    warn: { background: colors.warnSoft, foreground: colors.statusWarn },
  };
  const { background, foreground } = tones[tone];
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      {icon ? <Icon name={icon} size={14} color={foreground} /> : null}
      <Text variant="labelSmall" color={foreground}>
        {label}
      </Text>
    </View>
  );
}

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  icon?: IconName;
};

/** Figma "Text Field": eyebrow label over a 52 pt field; accent border when focused. */
export function TextField({ label, icon, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text variant="eyebrow" color="text3">
        {label}
      </Text>
      <View
        style={[
          styles.fieldBox,
          { backgroundColor: colors.surface },
          focused
            ? { borderWidth: 1.5, borderColor: colors.accent }
            : { borderWidth: 1, borderColor: colors.stroke },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.text3}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          keyboardAppearance="dark"
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, typography.body, { color: colors.text }]}
        />
        {icon ? <Icon name={icon} size={18} color={colors.text2} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonLarge: { height: 52, paddingHorizontal: 22, borderRadius: 26, gap: 8 },
  buttonSmall: { height: 36, paddingHorizontal: 14, borderRadius: 18, gap: 6 },
  block: { alignSelf: 'stretch' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glass: { borderWidth: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  field: { gap: 8, alignSelf: 'stretch' },
  fieldBox: {
    height: 52,
    borderRadius: radii.field,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  // outlineWidth hides the browser focus ring on web; the field's own border shows focus.
  input: { flex: 1, paddingVertical: 0, outlineWidth: 0 },
});
