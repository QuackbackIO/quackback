/** The composer block, as the portal draws it: a box visitors post from. */
import type { HomeBlockView } from './view'

export const composer = {
  type: 'composer',
  size: [12, 1],
  min: [4, 1],
  page: 'feedback',
  made: {},
} as const satisfies HomeBlockView
