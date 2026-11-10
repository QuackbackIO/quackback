/** The status block, as the portal draws it: whether everything is working. */
import type { HomeBlockView } from './view'

export const status = {
  type: 'status',
  size: [4, 1],
  min: [3, 1],
  page: 'status',
  made: {},
} as const satisfies HomeBlockView
