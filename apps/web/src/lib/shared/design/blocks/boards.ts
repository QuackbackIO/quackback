/** The boards block, as the portal draws it: the workspace’s boards, with their posts. */
import type { HomeBlockView } from './view'

export const boards = {
  type: 'boards',
  size: [6, 1],
  min: [4, 1],
  page: 'feedback',
  made: {},
} as const satisfies HomeBlockView
