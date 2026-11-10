/** The contact block, as the portal draws it: a way to reach the team. */
import type { HomeBlockView } from './view'

export const contact = {
  type: 'contact',
  size: [4, 1],
  min: [3, 1],
  page: 'support',
  made: {},
} as const satisfies HomeBlockView
