/**
 * Where the captured homepages of the measured sites live: outside the
 * repository (they are other companies' pages), in the local cache unless
 * QB_BRAND_CAPTURES_DIR names another directory. capture-live-sites.ts
 * writes them; live-captures.test.ts replays them when they are present.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LIVE_SITES = ['stripe.com', 'www.ikea.com', 'linear.app', 'notion.com'] as const

export function liveCapturesDir(): string {
  return (
    process.env.QB_BRAND_CAPTURES_DIR || join(homedir(), '.cache', 'qb-portal-customise', 'live')
  )
}
