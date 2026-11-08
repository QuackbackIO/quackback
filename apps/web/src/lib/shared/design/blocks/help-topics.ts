/** The help_topics block, as the portal draws it: the help center’s topics. */
import type { HomeBlockView } from './view'

export const helpTopics = {
  type: 'help_topics',
  size: [12, 1],
  min: [4, 1],
  page: 'help',
  made: { categoryIds: [] },
  counts: { topArticles: [0, 2, 3] },
} as const satisfies HomeBlockView
