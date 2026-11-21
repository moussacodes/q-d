/** Corner radii used by the Figma `20 · Mobile` components. */
export const radii = {
  xs: 10, // segments, small covers
  badge: 11, // provider badge
  tile: 12, // service tile
  field: 14, // text fields
  card: 18, // service card
  sheet: 20, // mini player
  pill: 999, // chips, icon buttons
} as const;

/** Spacing steps that appear in the Figma components. */
export const spacing = {
  xxs: 2,
  xs: 4,
  s: 6,
  m: 8,
  l: 10,
  xl: 12,
  xxl: 16,
  section: 20,
  screen: 20,
} as const;

/** The Figma frames are 390 × 844 (iPhone 14/15 size). */
export const designFrame = { width: 390, height: 844 } as const;
