/**
 * The single sign-on grace notice shares the paused notices' read and names
 * the last full day the way they do.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: vi.fn() }))

import { SSO_NOTICE_QUERY_KEY, ssoPausesText } from '../sso-pauses-notice'
import { PLAN_FEATURE_NOTICE_QUERY_KEY } from '@/components/admin/settings/plan-feature-notice-state'
import { formatFirstRenderDate } from '@/components/ui/local-date'

const usFormat = (date: unknown, options?: Intl.DateTimeFormatOptions) =>
  formatFirstRenderDate(date as string, options, 'en-US')

describe('SsoPausesNotice', () => {
  it('reads the same query as the paused feature notices', () => {
    expect(SSO_NOTICE_QUERY_KEY).toEqual(PLAN_FEATURE_NOTICE_QUERY_KEY)
  })

  it('names the last full day as a plain calendar date', () => {
    const now = new Date('2026-11-18T09:00:00.000Z')
    expect(ssoPausesText('2026-11-22', usFormat, now)).toBe('Single sign-on pauses after Nov 22.')
    expect(ssoPausesText('2027-01-01', usFormat, now)).toBe(
      'Single sign-on pauses after Jan 1, 2027.'
    )
  })
})
