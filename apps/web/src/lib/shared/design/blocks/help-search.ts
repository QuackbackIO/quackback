/** The help_search block, as the portal draws it: a search of the help center, with its popular articles. */
import type { HomeBlockView } from './view'

export const helpSearch = {
  type: 'help_search',
  size: [6, 1],
  min: [4, 1],
  page: 'help',
  made: {},
  counts: { popular: [0, 3, 5] },
} as const satisfies HomeBlockView
