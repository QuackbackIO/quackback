/** The roadmap block, as the portal draws it: a roadmap’s columns and their posts. */
import type { HomeBlockView } from './view'

export const roadmap = {
  type: 'roadmap',
  size: [12, 1],
  min: [6, 1],
  page: 'roadmap',
  made: { roadmapId: null },
  counts: { perColumn: [2, 3, 5] },
} as const satisfies HomeBlockView
