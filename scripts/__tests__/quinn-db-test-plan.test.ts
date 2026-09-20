import { describe, expect, it } from 'vitest'
import { quinnDbSuites, assertSuitePassed } from '../quinn-db-test-plan'

it('selects all five suites across the four dedicated databases without losing connection options', () => {
  const suites = quinnDbSuites('postgresql://test:secret@db.example:5433/base?sslmode=require')
  expect(suites).toHaveLength(5)
  expect(suites.map((s) => new URL(s.url).pathname)).toEqual([
    '/quackback_quinn_runs',
    '/quackback_quinn_runs',
    '/quackback_quinn_s5',
    '/quackback_quinn_s6',
    '/quackback_quinn_lifecycle',
  ])
  for (const suite of suites) {
    const url = new URL(suite.url)
    expect(url.host).toBe('db.example:5433')
    expect(url.search).toBe('?sslmode=require')
    expect(url.username).toBe('test')
    expect(url.password).toBe('secret')
    expect(suite.file).toMatch(/\.db\.test\.ts$/)
  }
})

describe('suite evidence', () => {
  const file = 'path/example.db.test.ts'
  const report = (statuses: string[]) => ({
    testResults: [
      {
        name: `/repo/${file}`,
        assertionResults: statuses.map((status) => ({ status })),
      },
    ],
  })
  it('accepts actual passing assertions in the requested suite', () => {
    expect(assertSuitePassed(report(['passed', 'passed']), file)).toBe(2)
  })
  it.each([[], ['pending'], ['skipped'], ['passed', 'failed'], ['passed', 'pending']])(
    'refuses empty, skipped or failed assertions: %j',
    (...statuses) => {
      expect(() => assertSuitePassed(report(statuses), file)).toThrow()
    }
  )
  it('refuses a report from a different suite even when its counts are green', () => {
    expect(() => assertSuitePassed(report(['passed']), 'another.db.test.ts')).toThrow()
  })
})
