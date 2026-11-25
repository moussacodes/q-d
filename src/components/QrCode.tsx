import { create } from 'qrcode';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/** The QR standard asks for four light modules around the code. */
export const QR_QUIET_ZONE = 4;

/**
 * The dark modules of `value` as one SVG path, in module units, with the
 * quiet zone included. Pure JavaScript (the `qrcode` package's encoder), so
 * it runs in Expo Go and on the web. Error correction M survives a scuffed
 * screen without making the code much denser.
 */
export function qrPath(value: string) {
  const { modules } = create(value, { errorCorrectionLevel: 'M' });
  const { size } = modules;
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules.get(row, col)) {
        path += `M${col + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`;
      }
    }
  }
  return { path, modules: size, extent: size + QR_QUIET_ZONE * 2 };
}

/**
 * A QR code drawn with react-native-svg. It scales to its box, so the
 * parent sets the size. Dark modules on a light background, which every
 * camera reads.
 */
export function QrCode({
  value,
  color,
  background,
  accessibilityLabel,
  style,
}: {
  value: string;
  color: string;
  background: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { path, extent } = useMemo(() => qrPath(value), [value]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.box, style]}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${extent} ${extent}`}>
        <Rect x={0} y={0} width={extent} height={extent} fill={background} />
        <Path d={path} fill={color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { aspectRatio: 1 },
});
