import { describe, it, expect } from 'vitest'
import {
  deriveTopLevelStatus,
  deriveImpact,
  deriveUptimeDays,
  type UptimeStatusEvent,
} from '../status.calc'
import type { StatusComponentStatus } from '@/lib/server/db'

describe('deriveTopLevelStatus', () => {
  it('is operational when there are no components', () => {
    expect(deriveTopLevelStatus([])).toBe('operational')
  })

  it('is operational when every component is operational', () => {
    expect(deriveTopLevelStatus(['operational', 'operational'])).toBe('operational')
  })

  it('returns the worst status present', () => {
    expect(deriveTopLevelStatus(['operational', 'degraded_performance'])).toBe(
      'degraded_performance'
    )
    expect(deriveTopLevelStatus(['degraded_performance', 'partial_outage'])).toBe('partial_outage')
    expect(deriveTopLevelStatus(['partial_outage', 'major_outage'])).toBe('major_outage')
  })

  it('ranks maintenance below the three outage severities', () => {
    // A maintenance + degraded mix surfaces as degraded, not maintenance.
    expect(deriveTopLevelStatus(['under_maintenance', 'degraded_performance'])).toBe(
      'degraded_performance'
    )
    // Maintenance alone still surfaces (it outranks operational).
    expect(deriveTopLevelStatus(['operational', 'under_maintenance'])).toBe('under_maintenance')
  })
})

describe('deriveImpact', () => {
  it('is none for empty or all-operational input', () => {
    expect(deriveImpact([])).toBe('none')
    expect(deriveImpact(['operational'])).toBe('none')
  })

  it('maps worst affected status to impact', () => {
    expect(deriveImpact(['degraded_performance'])).toBe('minor')
    expect(deriveImpact(['partial_outage'])).toBe('major')
    expect(deriveImpact(['major_outage'])).toBe('critical')
    expect(deriveImpact(['degraded_performance', 'major_outage'])).toBe('critical')
  })

  it('does not let maintenance raise impact', () => {
    expect(deriveImpact(['under_maintenance'])).toBe('none')
    expect(deriveImpact(['under_maintenance', 'degraded_performance'])).toBe('minor')
  })
})

describe('deriveUptimeDays', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n)) // 2026-01-n 00:00 UTC

  it('returns windowDays entries in ascending order ending today', () => {
    const now = new Date(Date.UTC(2026, 0, 10, 12)) // 2026-01-10 12:00 UTC
    const days = deriveUptimeDays([], 'operational', 5, now)
    expect(days).toHaveLength(5)
    expect(days[0].date).toBe('2026-01-06')
    expect(days[4].date).toBe('2026-01-10')
  })

  it('is 100% uptime with no events (baseline operational)', () => {
    const now = new Date(Date.UTC(2026, 0, 5, 12))
    const days = deriveUptimeDays([], 'operational', 3, now)
    expect(days.every((d) => d.uptimePct === 100)).toBe(true)
    expect(days.every((d) => d.worstStatus === 'operational')).toBe(true)
  })

  it('treats maintenance as uptime (not downtime)', () => {
    const now = new Date(Date.UTC(2026, 0, 3, 12))
    const events: UptimeStatusEvent[] = [
      { status: 'under_maintenance', createdAt: day(2) },
      { status: 'operational', createdAt: new Date(Date.UTC(2026, 0, 2, 6)) },
    ]
    const days = deriveUptimeDays(events, 'operational', 3, now)
    // Day 2026-01-02 spent time under maintenance but uptime stays 100%.
    const jan2 = days.find((d) => d.date === '2026-01-02')!
    expect(jan2.uptimePct).toBe(100)
    // worstStatus still reflects maintenance was present.
    expect(jan2.worstStatus).toBe('under_maintenance')
  })

  it('computes a half-day outage as 50% uptime', () => {
    const now = new Date(Date.UTC(2026, 0, 2, 0)) // start of 2026-01-02: 2026-01-01 is a full completed day
    const events: UptimeStatusEvent[] = [
      { status: 'major_outage', createdAt: new Date(Date.UTC(2026, 0, 1, 12)) }, // down from noon
    ]
    const days = deriveUptimeDays(events, 'operational', 2, now)
    const jan1 = days.find((d) => d.date === '2026-01-01')!
    expect(jan1.uptimePct).toBe(50)
    expect(jan1.worstStatus).toBe('major_outage')
  })

  it('carries the pre-window status forward when no event predates the window', () => {
    const now = new Date(Date.UTC(2026, 0, 3, 0))
    // Outage began before the window and never cleared.
    const events: UptimeStatusEvent[] = [
      { status: 'partial_outage', createdAt: new Date(Date.UTC(2025, 11, 20)) },
    ]
    const days = deriveUptimeDays(events, 'operational', 2, now)
    expect(days.every((d) => d.uptimePct === 0)).toBe(true)
    expect(days.every((d) => d.worstStatus === 'partial_outage')).toBe(true)
  })

  it('clips the final day at now rather than a full 24h', () => {
    const now = new Date(Date.UTC(2026, 0, 5, 6)) // only 6h into the day
    const events: UptimeStatusEvent[] = [
      { status: 'major_outage', createdAt: new Date(Date.UTC(2026, 0, 5, 3)) }, // down at 03:00
    ]
    const days = deriveUptimeDays(events, 'operational', 1, now)
    const jan5 = days.find((d) => d.date === '2026-01-05')!
    // 3h up of 6h elapsed = 50%.
    expect(jan5.uptimePct).toBe(50)
  })

  it('ignores events in the future relative to now', () => {
    const now = new Date(Date.UTC(2026, 0, 2, 12))
    const events: UptimeStatusEvent[] = [
      { status: 'major_outage', createdAt: new Date(Date.UTC(2026, 0, 9)) }, // future
    ]
    const days = deriveUptimeDays(events, 'operational', 2, now)
    expect(days.every((d) => d.uptimePct === 100)).toBe(true)
  })

  it('rounds uptime to two decimal places', () => {
    const now = new Date(Date.UTC(2026, 0, 2, 0))
    // Down for 1 of 24 hours -> 23/24 = 95.833... -> 95.83
    const events: UptimeStatusEvent[] = [
      { status: 'major_outage', createdAt: new Date(Date.UTC(2026, 0, 1, 0)) },
      { status: 'operational', createdAt: new Date(Date.UTC(2026, 0, 1, 1)) },
    ]
    const days = deriveUptimeDays(events, 'operational', 2, now)
    const jan1 = days.find((d) => d.date === '2026-01-01')!
    expect(jan1.uptimePct).toBeCloseTo(95.83, 2)
  })
})

// Type-level guard: keep the status list exhaustive if a status is added.
const _ALL_STATUSES: StatusComponentStatus[] = [
  'operational',
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
]
void _ALL_STATUSES
