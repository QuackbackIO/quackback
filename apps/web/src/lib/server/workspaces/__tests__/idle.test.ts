/**
 * The rescan grid: when a detached tier is allowed to look again.
 *
 * The measured defect is that each workspace scheduled its next look from
 * `detachedAt + interval`, so the fleet precessed and never shared a wake
 * window. These tests pin the replacement: one epoch-aligned slot plus a
 * stable per-workspace offset.
 */
import { describe, expect, it } from 'vitest'
import { nextRescanAt, rescanJitterMs, type WorkspaceIdlePolicy } from '../idle'

const LIVE: WorkspaceIdlePolicy = { detachAfterMs: 60_000, rescanIntervalMs: 900_000 }
const OFF: WorkspaceIdlePolicy = { detachAfterMs: 0, rescanIntervalMs: 900_000 }
const SHORT: WorkspaceIdlePolicy = { detachAfterMs: 60_000, rescanIntervalMs: 1_000 }

function expectedAt(now: number, interval: number, jitter: number): number {
  // Smallest `k * interval + jitter` strictly after `now`.
  const k = Math.floor((now - jitter) / interval) + 1
  return k * interval + jitter
}

describe('rescanJitterMs', () => {
  it('is deterministic for a key and stays inside [0, 30s]', () => {
    expect(rescanJitterMs('inst_a')).toBe(rescanJitterMs('inst_a'))
    const keys = Array.from({ length: 80 }, (_, i) => `inst_${i}`)
    const jitters = keys.map(rescanJitterMs)
    for (const j of jitters) {
      expect(j).toBeGreaterThanOrEqual(0)
      expect(j).toBeLessThanOrEqual(30_000)
    }
    expect(new Set(jitters).size).toBeGreaterThan(1)
  })
})

describe('nextRescanAt', () => {
  it('lands on an epoch-aligned multiple plus that workspace’s jitter', () => {
    const key = 'inst_grid'
    const jitter = rescanJitterMs(key)
    const nows = [
      10 * LIVE.rescanIntervalMs,
      10 * LIVE.rescanIntervalMs - 1,
      10 * LIVE.rescanIntervalMs + 1,
      10 * LIVE.rescanIntervalMs + jitter,
      10 * LIVE.rescanIntervalMs + jitter + 1,
    ]
    for (const now of nows) {
      const at = nextRescanAt(now, LIVE, key)
      expect(at).toBe(expectedAt(now, LIVE.rescanIntervalMs, jitter))
      expect((at - jitter) % LIVE.rescanIntervalMs).toBe(0)
      expect(at).toBeGreaterThan(now)
    }
  })

  it('treats a time exactly on a multiple as that slot if jitter is still ahead', () => {
    const interval = LIVE.rescanIntervalMs
    const onGrid = 4 * interval
    // Find a key whose offset is not zero so "exactly on a multiple" is
    // distinguishable from "go to the next slot".
    const key = Array.from({ length: 200 }, (_, i) => `slot_${i}`).find(
      (k) => rescanJitterMs(k) > 0
    )
    expect(key).toBeDefined()
    const jitter = rescanJitterMs(key as string)
    expect(nextRescanAt(onGrid, LIVE, key as string)).toBe(onGrid + jitter)
    expect(nextRescanAt(onGrid - 1, LIVE, key as string)).toBe(onGrid + jitter)
    expect(nextRescanAt(onGrid + 1, LIVE, key as string)).toBe(onGrid + jitter)
  })

  it('skips a slot whose jitter has already elapsed', () => {
    const interval = LIVE.rescanIntervalMs
    const key = Array.from({ length: 200 }, (_, i) => `past_${i}`).find(
      (k) => rescanJitterMs(k) > 0
    )
    expect(key).toBeDefined()
    const jitter = rescanJitterMs(key as string)
    const onGrid = 7 * interval
    expect(nextRescanAt(onGrid + jitter, LIVE, key as string)).toBe(onGrid + interval + jitter)
    expect(nextRescanAt(onGrid + jitter + 1, LIVE, key as string)).toBe(onGrid + interval + jitter)
  })

  it('returns the same instant for the same key and the same now', () => {
    const now = Date.parse('2026-08-17T12:00:00.000Z')
    expect(nextRescanAt(now, LIVE, 'inst_a')).toBe(nextRescanAt(now, LIVE, 'inst_a'))
  })

  it('spreads different keys across the 30s window after the same grid line', () => {
    const now = 3 * LIVE.rescanIntervalMs
    const ats = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((k) =>
      nextRescanAt(now, LIVE, k)
    )
    const grids = new Set(
      ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(
        (k) => nextRescanAt(now, LIVE, k) - rescanJitterMs(k)
      )
    )
    expect(grids.size).toBe(1)
    expect(Math.max(...ats) - Math.min(...ats)).toBeLessThanOrEqual(30_000)
  })

  it('still aligns when the interval is shorter than the jitter ceiling', () => {
    const key = 'inst_short'
    const jitter = rescanJitterMs(key)
    const now = 42 * SHORT.rescanIntervalMs + 3
    const at = nextRescanAt(now, SHORT, key)
    expect(at).toBe(expectedAt(now, SHORT.rescanIntervalMs, jitter))
    expect((at - jitter) % SHORT.rescanIntervalMs).toBe(0)
  })

  it('does not invent a wake when detach is disabled', () => {
    const now = 1_700_000
    expect(nextRescanAt(now, OFF, 'inst_a')).toBe(now + OFF.rescanIntervalMs)
    expect(nextRescanAt(now, OFF, 'inst_b')).toBe(now + OFF.rescanIntervalMs)
    expect(nextRescanAt(now, { detachAfterMs: -1, rescanIntervalMs: 5_000 }, 'inst_a')).toBe(
      now + 5_000
    )
  })
})
