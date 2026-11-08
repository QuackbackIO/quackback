/** The links block, as the portal draws it: links to the workspace’s other places. */
import type { HomeBlockView } from './view'

export const links = {
  type: 'links',
  size: [4, 1],
  min: [3, 1],
  page: null,
  made: { links: [{ label: 'Our website', url: 'https://example.com' }] },
} as const satisfies HomeBlockView
