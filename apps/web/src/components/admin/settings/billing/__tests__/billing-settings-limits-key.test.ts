/**
 * The billing page reads the plan limits summary the banner keeps fresh by
 * its query key, written out rather than imported so the page ships none of
 * the plan limits code. If the two keys drift apart, a chooser or an upgrade
 * refreshes the banner but leaves the billing meters stale, so they are
 * pinned together here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/plan-limits', () => ({
  getPlanLimitsFn: vi.fn(),
  getPlanLimitsSummaryFn: vi.fn(),
}))

const { planLimitsQueries } = await import('@/lib/client/queries/plan-limits')

describe('the billing page and the banner share one summary', () => {
  it('reads the summary under the query key the banner fills', () => {
    const source = readFileSync(join(import.meta.dirname, '../billing-settings.tsx'), 'utf8')
    const key = planLimitsQueries.summary().queryKey
    const literal = `queryKey: [${key.map((part) => `'${part}'`).join(', ')}]`
    expect(source).toContain(literal)
    // A chooser invalidates everything under this prefix, the billing page included.
    expect(key.slice(0, planLimitsQueries.all.length)).toEqual([...planLimitsQueries.all])
  })
})
