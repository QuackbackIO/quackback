/**
 * The canvas's own colours. They are deliberately not theme tokens: they must
 * read over any brand, so they never follow the workspace's colours.
 * portal-preview-designer.ts repeats CANVAS_PICKED as a literal, because the
 * frame's script imports nothing from the builder; a test keeps them equal.
 */

/** The picked block's outline, chip and drag bars. */
export const CANVAS_PICKED = '#2563eb'

/** What changed, outlined: neutral grey, never the brand's colour or the pick's blue. */
export const CANVAS_CHANGED = '#71717a'

/** The white edge around a blue outline, so it reads on a blue brand. */
export const CANVAS_HALO = '0 0 0 1px #fff, inset 0 0 0 1px #fff'
