import { describe, it, expect } from 'vitest'
import { buildTeammatePerformance } from '../teammate-performance'

describe('buildTeammatePerformance', () => {
  it('aggregates handled count and medians per teammate, sorted by handled desc', () => {
    const r = buildTeammatePerformance([
      // Ada: 2 handled, first responses 30m + 90m → median 60; closes 2h + 4h → median 3h
      {
        agentId: 'a',
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-07-01T09:00:00Z',
        firstResponseAt: '2026-07-01T09:30:00Z',
        closedAt: '2026-07-01T11:00:00Z',
      },
      {
        agentId: 'a',
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-07-02T09:00:00Z',
        firstResponseAt: '2026-07-02T10:30:00Z',
        closedAt: '2026-07-02T13:00:00Z',
      },
      // Ben: 1 handled, no reply yet, still open → null medians
      {
        agentId: 'b',
        displayName: 'Ben',
        avatarUrl: 'https://example.com/b.png',
        createdAt: '2026-07-03T09:00:00Z',
        firstResponseAt: null,
        closedAt: null,
      },
    ])
    expect(r).toEqual([
      {
        agentId: 'a',
        displayName: 'Ada',
        avatarUrl: null,
        handled: 2,
        medianFirstResponseMinutes: 60,
        medianCloseMinutes: 180,
      },
      {
        agentId: 'b',
        displayName: 'Ben',
        avatarUrl: 'https://example.com/b.png',
        handled: 1,
        medianFirstResponseMinutes: null,
        medianCloseMinutes: null,
      },
    ])
  })

  it('averages the two middle values for an even sample, mirroring percentile_cont', () => {
    const r = buildTeammatePerformance([
      {
        agentId: 'a',
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-07-01T00:00:00Z',
        firstResponseAt: '2026-07-01T00:10:00Z',
        closedAt: null,
      },
      {
        agentId: 'a',
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-07-01T01:00:00Z',
        firstResponseAt: '2026-07-01T01:20:00Z',
        closedAt: null,
      },
    ])
    expect(r[0].medianFirstResponseMinutes).toBe(15)
  })

  it('falls back to the agent id when the principal left no display name', () => {
    const r = buildTeammatePerformance([
      {
        agentId: 'principal_xyz',
        displayName: null,
        avatarUrl: null,
        createdAt: '2026-07-01T09:00:00Z',
        firstResponseAt: '2026-07-01T09:05:00Z',
        closedAt: '2026-07-01T10:00:00Z',
      },
    ])
    expect(r[0].displayName).toBe('principal_xyz')
  })
})
