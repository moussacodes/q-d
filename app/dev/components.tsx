import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Backdrop,
  Button,
  Chip,
  Icon,
  IconButton,
  iconNames,
  ListenerRow,
  Logo,
  MiniPlayer,
  ProviderBadge,
  QueueRow,
  SegmentedControl,
  ServiceCard,
  Text,
  TextField,
  Toggle,
} from '@/components';
import {
  idlePalette,
  neutral,
  previewPaletteLabels,
  previewPalettes,
  typography,
  useTheme,
  type PreviewPaletteName,
  type TypographyVariant,
} from '@/design';

/**
 * Development-only gallery of the design tokens and components from the
 * Figma `20 · Mobile` "Components" frame. Switch the Now playing mode to see
 * every component re-color the way it will when a different song plays.
 */
export default function ComponentGallery() {
  const insets = useSafeAreaInsets();
  const { colors, setPalette } = useTheme();
  const [mode, setMode] = useState<PreviewPaletteName>('sonOfSpergy');
  const [toggleOn, setToggleOn] = useState(true);
  const [segment, setSegment] = useState<'one' | 'two'>('one');
  const [name, setName] = useState('');

  // Apply the chosen mode; go back to idle when leaving the gallery.
  useEffect(() => {
    setPalette(previewPalettes[mode]);
  }, [mode, setPalette]);
  useEffect(() => () => setPalette(idlePalette), [setPalette]);

  const chooseMode = (next: PreviewPaletteName) => setMode(next);

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.header}>
          <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => router.back()} />
          <Text variant="heading">Component gallery</Text>
        </View>

        <Section title="Now playing mode">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SegmentedControl
              options={(Object.keys(previewPalettes) as PreviewPaletteName[]).map((value) => ({
                value,
                label: previewPaletteLabels[value],
              }))}
              value={mode}
              onChange={chooseMode}
            />
          </ScrollView>
        </Section>

        <Section title="Colors">
          <View style={styles.wrap}>
            {(
              [
                'accent',
                'onAccent',
                'accentSoft',
                'glow1',
                'glow2',
                'glow3',
                ...(Object.keys(neutral) as (keyof typeof neutral)[]),
              ] as const
            ).map((token) => (
              <View key={token} style={styles.swatchItem}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: colors[token], borderColor: colors.stroke },
                  ]}
                />
                <Text variant="monoSmall" color="text3">
                  {token}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Typography">
          {(Object.keys(typography) as TypographyVariant[]).map((variant) => (
            <Text key={variant} variant={variant}>
              {variant === 'logo' ? "q'd" : `${variant} · Different apps. One aux.`}
            </Text>
          ))}
        </Section>

        <Section title="Icons">
          <View style={styles.wrap}>
            {iconNames.map((icon) => (
              <Icon key={icon} name={icon} />
            ))}
          </View>
        </Section>

        <Section title="Primitives">
          <View style={styles.row}>
            <Logo />
            <Avatar initial="B" />
            <Toggle value={toggleOn} onValueChange={setToggleOn} accessibilityLabel="Sample toggle" />
            <Toggle value={!toggleOn} onValueChange={(v) => setToggleOn(!v)} accessibilityLabel="Sample toggle 2" />
          </View>
          <SegmentedControl
            options={[
              { value: 'one', label: 'Option' },
              { value: 'two', label: 'Option' },
            ]}
            value={segment}
            onChange={setSegment}
          />
          <View style={styles.row}>
            <ProviderBadge provider="spotify" />
            <ProviderBadge provider="apple_music" />
          </View>
        </Section>

        <Section title="Controls">
          <View style={styles.wrap}>
            <Button label="Button" />
            <Button label="Button" size="small" />
            <Button label="Button" kind="secondary" />
            <Button label="Button" kind="secondary" size="small" />
            <Button label="Button" kind="ghost" />
            <Button label="Button" kind="ghost" size="small" />
          </View>
          <View style={styles.row}>
            <IconButton icon="link" accessibilityLabel="Surface" />
            <IconButton icon="link" kind="accent" accessibilityLabel="Accent" />
            <IconButton icon="link" kind="glass" accessibilityLabel="Glass" />
          </View>
          <View style={styles.row}>
            <Chip label="Chip" />
            <Chip label="Chip" tone="accent" />
            <Chip label="Chip" tone="ok" />
            <Chip label="Chip" tone="warn" />
          </View>
          <TextField label="Label" placeholder="Value" value={name} onChangeText={setName} />
        </Section>

        <Section title="Rows & cards">
          <QueueRow
            title="Lovers Rock"
            artist="TV Girl"
            provider="spotify"
            addedBy="by Jules"
            duration="3:33"
            showGrip
          />
          <QueueRow
            title="Lovers Rock"
            artist="TV Girl"
            provider="spotify"
            addedBy="by Jules"
            duration="3:33"
            note="Not on Apple Music · the host can switch for the next song or skip"
          />
          <ListenerRow
            name="Maya"
            initial="M"
            status="Listening"
            provider="apple_music"
            trailing={
              <>
                <Chip label="Skip" tone="accent" icon="check" />
                <Chip label="Reorder" />
              </>
            }
          />
          <MiniPlayer
            title="Have a Baby (With Me)"
            subtitle="Daniel Caesar · Sunday Slow Burn"
            playing
            progress={0.45}
          />
          <ServiceCard
            provider="spotify"
            name="Spotify"
            description="Connected as baron.li · Premium"
            state="connected"
          />
          <ServiceCard
            provider="apple_music"
            name="Apple Music"
            description="Play songs from your library"
            state="connect"
          />
          <ServiceCard
            provider="spotify"
            name="Spotify"
            description="Connected as baron.li · Premium"
            state="ready"
          />
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="eyebrow" color="text3">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  swatchItem: { width: 96, gap: 6 },
  swatch: { height: 40, borderRadius: 10, borderWidth: 1 },
});
