/**
 * Shared analytics layout constants.
 *
 * Kept free of recharts (and any heavy deps) so both the lazy-loaded chart and
 * the eagerly-rendered page/skeletons can import it without pulling recharts
 * into the page bundle.
 */

/** Hero activity-chart height. The chart, its empty state, and both loading
 *  skeletons share this so the layout never jumps between states. */
export const CHART_HEIGHT_CLASS = 'h-[clamp(300px,46vh,520px)]'
