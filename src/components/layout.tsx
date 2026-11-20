import { router, useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { idlePalette, neutral, useTheme, type NowPlayingPalette } from '@/design';

import { Backdrop } from './Backdrop';
import { IconButton } from './controls';
import { Text } from './Text';
import type { HeightProbe } from './useMeasuredHeight';

export const SCREEN_PADDING = 20;
/** Space above a Screen's first child, under the header. */
export const SCREEN_TOP_PADDING = 16;
/** Space between a Screen's children. */
export const SCREEN_GAP = 24;

/** Applies a Now playing palette while the screen is focused. */
export function useScreenPalette(palette: NowPlayingPalette = idlePalette) {
  const { setPalette } = useTheme();
  useFocusEffect(
    useCallback(() => {
      setPalette(palette);
    }, [palette, setPalette]),
  );
}

type ScreenProps = {
  children: ReactNode;
  /** Fixed content under the scroll area, e.g. a primary button. */
  footer?: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  /** Measures the area between header and footer (from `useMeasuredHeight`). */
  viewport?: HeightProbe;
};

/** Full-screen page: backdrop glow, safe areas, header, scrolling content, footer. */
export function Screen({
  children,
  footer,
  header,
  scroll = true,
  contentStyle,
  viewport,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const body = [styles.content, contentStyle];
  return (
    <View style={styles.screen}>
      <Backdrop />
      <View style={{ paddingTop: insets.top }}>{header}</View>
      {scroll ? (
        // Measured on a plain View: on native a ScrollView ref isn't a host view.
        <View style={styles.flex} ref={viewport?.target} onLayout={viewport?.onLayout}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[body, { paddingBottom: footer ? 24 : insets.bottom + 24 }]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.flex, body]} ref={viewport?.target} onLayout={viewport?.onLayout}>
          {children}
        </View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

type ScreenHeaderProps = {
  title?: string;
  /** Defaults to router.back(). Pass null to hide the back button. */
  onBack?: (() => void) | null;
  center?: ReactNode;
  right?: ReactNode;
};

/** Back button, centered title, optional right slot (Figma "Header"). */
export function ScreenHeader({ title, onBack, center, right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {onBack === null ? null : (
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Back"
            onPress={onBack ?? (() => router.back())}
          />
        )}
      </View>
      <View style={styles.headerCenter}>
        {center ?? (title ? <Text variant="bodyStrong">{title}</Text> : null)}
      </View>
      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  );
}

/** Large page intro: optional eyebrow, title and supporting text. */
export function Intro({
  eyebrow,
  title,
  body,
  size = 'display',
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  size?: 'display' | 'title';
}) {
  return (
    <View style={styles.intro}>
      {eyebrow ? (
        <Text variant="eyebrow" color="text3">
          {eyebrow}
        </Text>
      ) : null}
      <Text variant={size}>{title}</Text>
      {body ? (
        <Text variant="footnote" color="text2">
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** Eyebrow label above a group of content. */
export function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text variant="eyebrow" color="text3">
        {children}
      </Text>
      {right ? (
        <Text variant="eyebrow" color="text3">
          {right}
        </Text>
      ) : null}
    </View>
  );
}

/** Rounded panel used for grouped rows and cards. */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.stroke }, style]}
    >
      {children}
    </View>
  );
}

/** Onboarding progress: one dash per step (Figma "Stepper"). */
export function Stepper({ step, total = 3 }: { step: number; total?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.stepper}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[
            styles.step,
            { backgroundColor: index < step ? colors.text : colors.surfaceRaised },
          ]}
        />
      ))}
    </View>
  );
}

/** Sheet content: grab handle, title, optional subtitle and close button. */
export function SheetHeader({
  title,
  subtitle,
  onClose = () => router.back(),
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sheetHeaderWrap}>
      <View style={[styles.handle, { backgroundColor: colors.strokeStrong }]} />
      <View style={styles.sheetHeader}>
        <View style={styles.flex}>
          <Text variant="title">{title}</Text>
          {subtitle ? (
            <Text variant="footnote" color="text2">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton icon="x" accessibilityLabel="Close" onPress={onClose} />
      </View>
    </View>
  );
}

/** Background for sheet routes (presented as modals). */
export function SheetScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View style={[styles.sheet, { backgroundColor: neutral.bg }]}>
      <View style={[styles.sheetGlow, { backgroundColor: colors.glow1 }]} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  content: { paddingHorizontal: SCREEN_PADDING, paddingTop: SCREEN_TOP_PADDING, gap: SCREEN_GAP },
  footer: { paddingHorizontal: SCREEN_PADDING, paddingTop: 12, gap: 12, alignItems: 'center' },
  header: {
    height: 56,
    paddingHorizontal: SCREEN_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: { width: 88, flexDirection: 'row', alignItems: 'center' },
  headerRight: { justifyContent: 'flex-end', gap: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  intro: { gap: 10 },
  sectionLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panel: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  stepper: { flexDirection: 'row', gap: 6 },
  step: { width: 22, height: 3, borderRadius: 2 },
  sheetHeaderWrap: { gap: 14 },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sheet: { flex: 1, overflow: 'hidden' },
  sheetGlow: {
    position: 'absolute',
    top: -220,
    alignSelf: 'center',
    width: 420,
    height: 320,
    borderRadius: 210,
    opacity: 0.18,
  },
  sheetContent: { paddingHorizontal: SCREEN_PADDING, paddingTop: 10, gap: 20 },
});
