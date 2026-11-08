/** The updates block, as the portal draws it: the latest changelog entries. */
import type { HomeBlockView } from './view'

export const updates = {
  type: 'updates',
  size: [6, 1],
  min: [4, 1],
  page: 'changelog',
  made: { count: 3 },
  counts: { count: [2, 3, 4] },
} as const satisfies HomeBlockView
