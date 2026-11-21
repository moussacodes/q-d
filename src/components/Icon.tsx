import { Image } from 'expo-image';

import { useTheme } from '@/design';

/** Icons exported from the Figma "Icons" component set (24 × 24 SVG). */
const icons = {
  'chevron-left': require('../../assets/icons/chevron-left.svg'),
  'chevron-right': require('../../assets/icons/chevron-right.svg'),
  'chevron-down': require('../../assets/icons/chevron-down.svg'),
  'chevron-up': require('../../assets/icons/chevron-up.svg'),
  plus: require('../../assets/icons/plus.svg'),
  x: require('../../assets/icons/x.svg'),
  check: require('../../assets/icons/check.svg'),
  search: require('../../assets/icons/search.svg'),
  link: require('../../assets/icons/link.svg'),
  refresh: require('../../assets/icons/refresh.svg'),
  pause: require('../../assets/icons/pause.svg'),
  play: require('../../assets/icons/play.svg'),
  skip: require('../../assets/icons/skip.svg'),
  maximize: require('../../assets/icons/maximize.svg'),
  minimize: require('../../assets/icons/minimize.svg'),
  settings: require('../../assets/icons/settings.svg'),
  grip: require('../../assets/icons/grip.svg'),
  users: require('../../assets/icons/users.svg'),
  lock: require('../../assets/icons/lock.svg'),
  copy: require('../../assets/icons/copy.svg'),
  share: require('../../assets/icons/share.svg'),
  mail: require('../../assets/icons/mail.svg'),
  music: require('../../assets/icons/music.svg'),
  'log-out': require('../../assets/icons/log-out.svg'),
  clipboard: require('../../assets/icons/clipboard.svg'),
  'arrow-right': require('../../assets/icons/arrow-right.svg'),
  alert: require('../../assets/icons/alert.svg'),
  sliders: require('../../assets/icons/sliders.svg'),
  eye: require('../../assets/icons/eye.svg'),
  more: require('../../assets/icons/more.svg'),
  user: require('../../assets/icons/user.svg'),
  hash: require('../../assets/icons/hash.svg'),
  apple: require('../../assets/icons/apple.svg'),
  google: require('../../assets/icons/google.svg'),
} as const;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

/** Multi-color icons keep their own colors. */
const multicolor = new Set<IconName>(['google']);

type IconProps = {
  name: IconName;
  /** Width and height in points. Figma uses 24, 20, 18, 16 and 14. */
  size?: number;
  /** Defaults to the theme's text color. */
  color?: string;
};

export function Icon({ name, size = 24, color }: IconProps) {
  const { colors } = useTheme();
  return (
    <Image
      source={icons[name]}
      style={{ width: size, height: size }}
      tintColor={multicolor.has(name) ? null : (color ?? colors.text)}
      contentFit="contain"
      accessible={false}
    />
  );
}
