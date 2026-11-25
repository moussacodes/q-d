import { BlurView } from 'expo-blur';
import type { ImageSource } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { providerColors, radii, useTheme } from '@/design';
import type { MusicProvider } from '@/domain/music-provider';

import { Button, Chip } from './controls';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Avatar, ProviderBadge } from './primitives';
import { Text } from './Text';

type QueueRowProps = {
  title: string;
  artist: string;
  provider: MusicProvider;
  /** e.g. "by Jules" */
  addedBy: string;
  /** e.g. "3:33" */
  duration: string;
  cover?: ImageSource | string | null;
  /** Shown in warning color under the row, e.g. availability problems. */
  note?: string;
  /** Show the reorder handle (host only). */
  showGrip?: boolean;
  /** Makes the row a button, e.g. to open the host's queue actions. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Highlights the row while its actions are open. */
  selected?: boolean;
  /** Shown under the row, e.g. the host's queue actions. */
  footer?: ReactNode;
};

/** Figma "Queue Row". */
export function QueueRow({
  title,
  artist,
  provider,
  addedBy,
  duration,
  cover,
  note,
  showGrip,
  onPress,
  accessibilityLabel,
  selected,
  footer,
}: QueueRowProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.queueRow,
        selected && [styles.queueRowSelected, { backgroundColor: colors.surface }],
      ]}
    >
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={onPress ? { expanded: !!selected } : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={styles.queueMain}
      >
        <Cover source={cover} size={44} />
        <View style={styles.info}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="footnote" color="text2" numberOfLines={1}>
            {artist}
          </Text>
        </View>
        <View style={styles.meta}>
          <ProviderBadge provider={provider} />
          <View style={styles.addedLine}>
            <Text variant="caption" color="text3">
              {addedBy}
            </Text>
            <Text variant="caption" color="text3">
              ·
            </Text>
            <Text variant="monoSmall" color="text3">
              {duration}
            </Text>
          </View>
        </View>
        {showGrip ? <Icon name="grip" size={18} color={colors.text3} /> : null}
      </Pressable>
      {note ? (
        <Text variant="caption" color="statusWarn" style={styles.note}>
          {note}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

type ListenerRowProps = {
  name: string;
  initial: string;
  avatarColor?: string;
  /** e.g. "Listening" */
  status: string;
  statusColor?: string;
  provider?: MusicProvider;
  /** Host-only controls, e.g. permission chips. */
  trailing?: ReactNode;
};

/** Figma "Listener Row". */
export function ListenerRow({
  name,
  initial,
  avatarColor,
  status,
  statusColor,
  provider,
  trailing,
}: ListenerRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.listenerRow}>
      <Avatar initial={initial} color={avatarColor} size={40} />
      <View style={styles.listenerInfo}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: statusColor ?? colors.statusOk }]} />
          <Text variant="caption" color="text2">
            {status}
          </Text>
          {provider ? <ProviderBadge provider={provider} /> : null}
        </View>
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

type MiniPlayerProps = {
  title: string;
  subtitle: string;
  cover?: ImageSource | string | null;
  playing: boolean;
  /** 0–1 */
  progress: number;
  onPress?: () => void;
  /** Without it (the room's rules leave you out), Play/Pause is disabled. */
  onTogglePlay?: () => void;
};

/** Figma "Mini Player": glass bar shown on Home while a room plays. */
export function MiniPlayer({
  title,
  subtitle,
  cover,
  playing,
  progress,
  onPress,
  onTogglePlay,
}: MiniPlayerProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.miniShadow}>
      <View
        style={[
          styles.mini,
          { backgroundColor: colors.sheetGlass, borderColor: colors.strokeStrong },
        ]}
      >
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open room. Now playing ${title}`}
          onPress={onPress}
          style={styles.miniOpen}
        >
          <Cover source={cover} size={44} />
          <View style={styles.info}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color="text2" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          disabled={!onTogglePlay}
          onPress={onTogglePlay}
          hitSlop={6}
          style={[
            styles.playButton,
            { backgroundColor: colors.accent },
            !onTogglePlay && styles.playDisabled,
          ]}
        >
          <Icon name={playing ? 'pause' : 'play'} size={20} color={colors.onAccent} />
        </Pressable>
        <View style={[styles.progressTrack, { backgroundColor: colors.surfaceRaised }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.accent,
                width: `${Math.min(Math.max(progress, 0), 1) * 100}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

type ServiceCardProps = {
  provider: MusicProvider;
  name: string;
  description: string;
  state: 'connected' | 'connect' | 'ready';
  onConnect?: () => void;
  /** Settings only: a connected service gets a Disconnect button. */
  onDisconnect?: () => void;
};

/** Figma "Service Card": a music service with its connection state. */
export function ServiceCard({
  provider,
  name,
  description,
  state,
  onConnect,
  onDisconnect,
}: ServiceCardProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.serviceCard,
        {
          backgroundColor: colors.surface,
          borderColor: state === 'connected' ? colors.okLine : colors.stroke,
        },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: providerColors[provider].tint }]}>
        <View style={[styles.tileDot, { backgroundColor: providerColors[provider].solid }]} />
      </View>
      <View style={styles.info}>
        <Text variant="bodyStrong">{name}</Text>
        <Text variant="caption" color="text2">
          {description}
        </Text>
      </View>
      {state === 'connected' && !onDisconnect ? (
        <Chip tone="ok" icon="check" label="Connected" />
      ) : null}
      {state === 'connected' && onDisconnect ? (
        <Button
          size="small"
          kind="secondary"
          label="Disconnect"
          accessibilityLabel={`Disconnect ${name}`}
          onPress={onDisconnect}
        />
      ) : null}
      {state === 'connect' ? <Button size="small" label="Connect" onPress={onConnect} /> : null}
      {state === 'ready' ? <Chip label="Ready" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  info: { flex: 1, minWidth: 0, gap: 2 },
  queueRow: { paddingVertical: 10, gap: 4 },
  queueRowSelected: {
    marginHorizontal: -10,
    paddingHorizontal: 10,
    borderRadius: radii.tile,
    gap: 10,
  },
  queueMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { alignItems: 'flex-end', gap: 4 },
  addedLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  note: { paddingLeft: 54 },
  listenerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  listenerInfo: { flex: 1, minWidth: 0, gap: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  trailing: { flexDirection: 'row', gap: 6 },
  miniShadow: {
    borderRadius: radii.sheet,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  mini: {
    height: 64,
    borderRadius: radii.sheet,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  miniOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { opacity: 0.4 },
  progressTrack: {
    position: 'absolute',
    left: 9,
    right: 11,
    top: 60,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: { height: 2, borderRadius: 1 },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radii.card,
    borderWidth: 1,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDot: { width: 14, height: 14, borderRadius: 7 },
});
