/**
 * How much of a brand colour a tinted Home block shows over the card colour,
 * percent. The portal paints it with color-mix in oklch (blockTintCss, in
 * home-blocks.tsx) and the solver measures the same mix (surfaces.ts), so
 * the two cannot drift. Kept apart from the colour maths, so the portal's
 * script carries none of it.
 */
export const BLOCK_TINT = 10

/** A tinted block's background, as the portal paints it: `fill` is a CSS colour or variable. */
export const blockTintCss = (fill: string) =>
  `color-mix(in oklch, ${fill} ${BLOCK_TINT}%, var(--qb-surface, var(--card)))`
