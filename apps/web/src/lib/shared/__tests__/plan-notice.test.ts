import { describe, it, expect } from 'vitest'
import { presentPlanNotice } from '../plan-notice'

const NOW = new Date('2026-06-15T12:00:00.000Z')

describe('presentPlanNotice', () => {
  it('returns null for no notice', () => {
    expect(presentPlanNotice(undefined, NOW)).toBeNull()
    expect(presentPlanNotice(null, NOW)).toBeNull()
  })

  it('renders a countdown with day granularity, not urgent when > 3 days out', () => {
    const v = presentPlanNotice({ label: 'Free trial', expiresAt: '2026-06-24T00:00:00.000Z' }, NOW)
    expect(v).toMatchObject({ label: 'Free trial', daysLeft: 9, urgent: false })
  })

  it('marks urgent at 3 days or fewer', () => {
    const v = presentPlanNotice({ label: 'Free trial', expiresAt: '2026-06-17T12:00:00.000Z' }, NOW)
    expect(v).toMatchObject({ daysLeft: 2, urgent: true })
  })

  it('hides an already-expired dated notice instead of clamping to "ends today"', () => {
    expect(
      presentPlanNotice({ label: 'Free trial', expiresAt: '2026-06-01T00:00:00.000Z' }, NOW)
    ).toBeNull()
  })

  it('hides a notice that expired less than a day ago, not "ends today"', () => {
    expect(
      presentPlanNotice({ label: 'Free trial', expiresAt: '2026-06-15T11:00:00.000Z' }, NOW)
    ).toBeNull()
  })

  it('keeps rendering a persistent ended strip after expiry', () => {
    const v = presentPlanNotice(
      { label: 'Pro trial ended', expiresAt: '2026-06-01T00:00:00.000Z', ended: true },
      NOW
    )
    expect(v).toMatchObject({ label: 'Pro trial ended', ended: true, daysLeft: 0 })
  })

  it('passes through label-only notices with no countdown', () => {
    const v = presentPlanNotice({ label: 'Maintenance window' }, NOW)
    expect(v).toMatchObject({ label: 'Maintenance window', daysLeft: null, urgent: false })
  })

  it('ignores an unparseable expiresAt', () => {
    const v = presentPlanNotice({ label: 'x', expiresAt: 'not-a-date' }, NOW)
    expect(v).toMatchObject({ daysLeft: null })
  })

  it('carries action fields through', () => {
    const v = presentPlanNotice(
      { label: 'x', actionUrl: 'https://e.com', actionLabel: 'Manage' },
      NOW
    )
    expect(v).toMatchObject({ actionUrl: 'https://e.com', actionLabel: 'Manage' })
  })
})
