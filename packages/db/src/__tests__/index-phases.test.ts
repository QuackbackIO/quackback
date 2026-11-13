/**
 * The index list is split by phase in one place: the boot builds and checks
 * only `boot` specs, and only `background` specs reach the background job.
 */
import { describe, expect, it } from 'vitest'
import { CONCURRENT_INDEX_SPECS, indexSpecsOfPhase, type ConcurrentIndexSpec } from '../schema-ops'

const SAMPLE: ConcurrentIndexSpec[] = [
  {
    name: 'a_boot_idx',
    concurrent: true,
    phase: 'boot',
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS a_boot_idx ON a (x)',
  },
  {
    name: 'b_background_idx',
    concurrent: true,
    phase: 'background',
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS b_background_idx ON b (x)',
  },
  {
    name: 'c_boot_idx',
    concurrent: false,
    phase: 'boot',
    ddl: 'CREATE INDEX IF NOT EXISTS c_boot_idx ON c (x)',
  },
]

describe('indexSpecsOfPhase', () => {
  it('gives the boot step only the boot specs, in list order', () => {
    expect(indexSpecsOfPhase('boot', SAMPLE).map((s) => s.name)).toEqual([
      'a_boot_idx',
      'c_boot_idx',
    ])
  })

  it('gives the background job only the background specs', () => {
    expect(indexSpecsOfPhase('background', SAMPLE).map((s) => s.name)).toEqual(['b_background_idx'])
  })

  it('splits the shipped list into two parts that cover it exactly', () => {
    const boot = indexSpecsOfPhase('boot')
    const background = indexSpecsOfPhase('background')
    expect(boot.length + background.length).toBe(CONCURRENT_INDEX_SPECS.length)
    expect(new Set([...boot, ...background].map((s) => s.name))).toEqual(
      new Set(CONCURRENT_INDEX_SPECS.map((s) => s.name))
    )
  })
})
