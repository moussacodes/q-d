import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { designFrame, useTheme } from '@/design';

/**
 * The cover-colored glow behind every screen (Figma "Backdrop").
 * Figma draws three circles with a 65 pt Gaussian blur; react-native-svg blur
 * filters are not reliable across platforms, so each circle is drawn as a
 * radial gradient that follows the same blur falloff.
 */
const BLUR = 65;

const glows = [
  { key: 'glow1', cx: 50, cy: 70, r: 240, opacity: 0.5 },
  { key: 'glow3', cx: 320, cy: 240, r: 150, opacity: 0.32 },
  { key: 'glow2', cx: 370, cy: 720, r: 220, opacity: 0.4 },
] as const;

/** Standard normal CDF (Abramowitz–Stegun approximation). */
function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Gradient stops for a blurred disc of radius r, out to r + 3σ. */
function blurStops(r: number) {
  const outer = r + 3 * BLUR;
  const stops = [{ offset: 0, opacity: normalCdf(r / BLUR) }];
  for (let k = -2; k <= 3; k++) {
    const distance = r + k * BLUR;
    if (distance > 0) {
      stops.push({ offset: distance / outer, opacity: normalCdf(-k) });
    }
  }
  return { outer, stops };
}

export function Backdrop() {
  const { colors } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${designFrame.width} ${designFrame.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {glows.map(({ key, cx, cy, r }) => {
            const { outer, stops } = blurStops(r);
            return (
              <RadialGradient
                key={key}
                id={key}
                cx={cx}
                cy={cy}
                r={outer}
                gradientUnits="userSpaceOnUse"
              >
                {stops.map((stop) => (
                  <Stop
                    key={stop.offset}
                    offset={stop.offset}
                    stopColor={colors[key]}
                    stopOpacity={stop.opacity}
                  />
                ))}
              </RadialGradient>
            );
          })}
        </Defs>
        <Rect width={designFrame.width} height={designFrame.height} fill={colors.bg} />
        {glows.map(({ key, cx, cy, r, opacity }) => (
          <Circle
            key={key}
            cx={cx}
            cy={cy}
            r={blurStops(r).outer}
            fill={`url(#${key})`}
            opacity={opacity}
          />
        ))}
      </Svg>
    </View>
  );
}
