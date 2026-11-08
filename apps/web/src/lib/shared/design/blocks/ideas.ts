/** The ideas block, as the portal draws it: the posts visitors vote for most. */
import type { HomeBlockView } from './view'

export const ideas = {
  type: 'ideas',
  size: [6, 1],
  min: [4, 1],
  page: 'feedback',
  made: { sort: 'trending', count: 3 },
  counts: { count: [3, 5, 10] },
} as const satisfies HomeBlockView
