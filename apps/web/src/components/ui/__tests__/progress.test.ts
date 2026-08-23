import { describe, expect, it } from 'vitest'
import { progressFillClass } from '../progress'

describe('progressFillClass', () => {
  it('is primary below 80%, amber from 80%, destructive at 100%', () => {
    expect(progressFillClass(0)).toBe('bg-primary')
    expect(progressFillClass(79)).toBe('bg-primary')
    expect(progressFillClass(80)).toBe('bg-amber-500')
    expect(progressFillClass(99)).toBe('bg-amber-500')
    expect(progressFillClass(100)).toBe('bg-destructive')
  })
})
