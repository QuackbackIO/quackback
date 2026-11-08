/**
 * How much of a brand colour a tinted Home block shows over the card colour,
 * percent. The portal paints it with color-mix in oklch (home-blocks.tsx) and
 * the solver measures the same mix (surfaces.ts), so the two cannot drift.
 * Kept apart from the colour maths, so the portal's script carries none of it.
 */
export const BLOCK_TINT = 10
