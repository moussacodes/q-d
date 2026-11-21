import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { radii, useTheme } from '@/design';

import { Icon } from './Icon';
import { useScrollLock } from './layout';
import { Text } from './Text';

/** How far a row slides left to show Delete: the button plus a gap. */
export const SWIPE_REVEAL = 76;
/** Sideways travel before a drag counts as a swipe rather than a tap or a scroll. */
const SLOP = 10;
/** A flick faster than this (points per ms) opens or closes the row, however short. */
const FLICK = 0.3;
/** Past open, the row follows the finger at this fraction, up to this many points. */
const STRETCH = 0.3;
const MAX_STRETCH = 48;

/** A drag that's clearly sideways belongs to the row. Anything else scrolls the list. */
export function isSideways(dx: number, dy: number) {
  return Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/** Where a let-go row comes to rest: open (Delete showing) or closed. */
export function restsOpen(offset: number, velocity: number) {
  if (velocity < -FLICK) return true;
  if (velocity > FLICK) return false;
  return offset < -SWIPE_REVEAL / 2;
}

const slide = (value: Animated.Value, open: boolean) =>
  Animated.spring(value, {
    toValue: open ? -SWIPE_REVEAL : 0,
    useNativeDriver: false,
    bounciness: 0,
    speed: 20,
  }).start();

type SwipeToDeleteProps = {
  children: ReactNode;
  /** Passed back to `onOpenChange`, so one stable callback serves a whole list. */
  id: string;
  /** Delete is showing. The parent keeps one row open at a time. */
  open: boolean;
  /** Keep this stable (e.g. `useCallback`): a new one rebuilds the gesture. */
  onOpenChange: (id: string, open: boolean) => void;
  onDelete: () => void;
  /** e.g. "Delete Always". */
  deleteLabel: string;
  testID?: string;
};

/**
 * A row that slides left to show a Delete button. Taps still reach the row.
 * Built on PanResponder, so it needs no gesture library (ARCHITECTURE.md,
 * open decision 4). The screen stops scrolling while the row is dragged.
 */
export function SwipeToDelete({
  children,
  id,
  open,
  onOpenChange,
  onDelete,
  deleteLabel,
  testID,
}: SwipeToDeleteProps) {
  const { colors } = useTheme();
  const lockScroll = useScrollLock();
  // Where the finger has taken the row. It can go past either end while
  // dragging; `position` is where the row is drawn.
  const [offset] = useState(() => new Animated.Value(0));
  // On web, letting go of a drag also clicks whatever is under the pointer,
  // and the row would take that as a tap. While dragged, the row ignores the
  // pointer, so the click lands outside it. (Native cancels the tap itself.)
  const [dragging, setDragging] = useState(false);

  const { position, reveal } = useMemo(() => {
    const drawn = offset.interpolate({
      inputRange: [-SWIPE_REVEAL - MAX_STRETCH / STRETCH, -SWIPE_REVEAL, 0, 1],
      outputRange: [-SWIPE_REVEAL - MAX_STRETCH, -SWIPE_REVEAL, 0, 0],
      extrapolate: 'clamp',
    });
    return {
      position: { transform: [{ translateX: drawn }] },
      reveal: {
        opacity: drawn.interpolate({
          inputRange: [-SWIPE_REVEAL, -SWIPE_REVEAL / 3, 0],
          outputRange: [1, 0, 0],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            translateX: drawn.interpolate({
              inputRange: [-SWIPE_REVEAL, 0],
              outputRange: [0, 16],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
    };
  }, [offset]);

  // Follow the parent, e.g. this row closes when another one opens.
  useEffect(() => {
    slide(offset, open);
  }, [offset, open]);

  const pan = useMemo(() => {
    const settle = (velocity: number) => {
      lockScroll(false);
      setDragging(false);
      offset.flattenOffset();
      offset.stopAnimation((at) => {
        const next = restsOpen(at, velocity);
        slide(offset, next);
        onOpenChange(id, next);
      });
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => isSideways(dx, dy),
      onPanResponderGrant: () => {
        lockScroll(true);
        setDragging(true);
        // Carry on from wherever the row is, even mid-spring.
        offset.stopAnimation();
        offset.extractOffset();
      },
      onPanResponderMove: (_, { dx }) => offset.setValue(dx),
      onPanResponderRelease: (_, { vx }) => settle(vx),
      onPanResponderTerminate: (_, { vx }) => settle(vx),
      // Once the row has the drag, the list can't take it back.
      onPanResponderTerminationRequest: () => false,
    });
  }, [id, lockScroll, offset, onOpenChange]);

  return (
    <View>
      <Animated.View
        testID={testID}
        style={[position, dragging && styles.ignorePointer]}
        {...pan.panHandlers}
      >
        {children}
      </Animated.View>
      <Animated.View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        style={[styles.action, { pointerEvents: open ? 'auto' : 'none' }, reveal]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={onDelete}
          style={[styles.button, { backgroundColor: colors.danger }]}
        >
          <Icon name="trash" size={20} color={colors.bg} />
          <Text variant="caption" color="bg">
            Delete
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ignorePointer: { pointerEvents: 'none' },
  action: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    right: 0,
    width: SWIPE_REVEAL - 10,
  },
  button: {
    flex: 1,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
