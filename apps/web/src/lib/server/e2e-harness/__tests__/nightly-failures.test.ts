import { describe, expect, it } from 'vitest'
import {
  failedTests,
  summarizeNightly,
  type PlaywrightReport,
} from '@/lib/server/e2e-harness/nightly-failures'

const report: PlaywrightReport = {
  suites: [
    {
      title: 'feedback/admin-inbox.spec.ts',
      specs: [
        {
          title: 'FBA-I-16 inbox search switches to Best match',
          file: 'feedback/admin-inbox.spec.ts',
          line: 40,
          tests: [{ projectName: 'product', status: 'unexpected' }],
        },
        {
          title: 'FBA-I-17 passes',
          file: 'feedback/admin-inbox.spec.ts',
          line: 60,
          tests: [{ projectName: 'product', status: 'expected' }],
        },
        {
          title: 'FBA-I-18 flaky is not a failure',
          file: 'feedback/admin-inbox.spec.ts',
          line: 80,
          tests: [{ projectName: 'product', status: 'flaky' }],
        },
      ],
      suites: [
        {
          title: 'REST',
          specs: [
            {
              title: 'API-R-144 API-R-146 metadata writes',
              file: 'feedback/admin-inbox.spec.ts',
              line: 99,
              tests: [{ projectName: 'product-serial', status: 'unexpected' }],
            },
          ],
        },
      ],
    },
  ],
}

const base = { runUrl: 'https://example.test/run/1', date: '2026-11-21' }

describe('failedTests', () => {
  it('lists only failed tests, with their journey ids and describe path', () => {
    expect(failedTests(report)).toEqual([
      {
        ids: ['FBA-I-16'],
        title: 'FBA-I-16 inbox search switches to Best match',
        project: 'product',
        location: 'feedback/admin-inbox.spec.ts:40',
      },
      {
        ids: ['API-R-144', 'API-R-146'],
        title: 'REST › API-R-144 API-R-146 metadata writes',
        project: 'product-serial',
        location: 'feedback/admin-inbox.spec.ts:99',
      },
    ])
  })
})

describe('summarizeNightly', () => {
  it('lists the failed jobs and tests, and names a failed job with no report', () => {
    const summary = summarizeNightly({
      ...base,
      jobs: {
        'product-core': { result: 'failure' },
        'product-core-report': { result: 'failure' },
        'support-isolated': { result: 'failure' },
        'e2e-quarantine': { result: 'success' },
        'e2e-full': { result: 'success' },
      },
      reports: [{ label: 'product-core', report }],
    })
    expect(summary.status).toBe('failed')
    expect(summary.body).toContain('Run: https://example.test/run/1')
    expect(summary.body).toContain('### product-core: 2 failed')
    expect(summary.body).toContain('- **FBA-I-16** [product] FBA-I-16 inbox search')
    expect(summary.body).toContain('No failing tests in a report for: `support-isolated`.')
    expect(summary.body).not.toContain('FBA-I-18')
  })

  it('keeps the comment under the GitHub limit on a very bad night', () => {
    const spec = {
      title: `AB-C-01 ${'x'.repeat(2000)}`,
      file: 'a.spec.ts',
      line: 1,
      tests: [{ projectName: 'product', status: 'unexpected' as const }],
    }
    const big: PlaywrightReport = { suites: [{ title: 'a.spec.ts', specs: Array(40).fill(spec) }] }
    const summary = summarizeNightly({
      ...base,
      jobs: { 'product-core': { result: 'failure' } },
      reports: ['a', 'b'].map((label) => ({ label, report: big })),
    })
    expect(summary.body.length).toBeLessThan(65_536)
    expect(summary.body).toContain('(Truncated: see the run for the rest.)')
  })

  it('is green when every watched job passed or was skipped', () => {
    const summary = summarizeNightly({
      ...base,
      jobs: {
        'product-core': { result: 'success' },
        'support-changes': { result: 'skipped' },
        'e2e-quarantine': { result: 'failure' },
      },
      reports: [],
    })
    expect(summary.status).toBe('green')
    expect(summary.body).toBe('Nightly e2e 2026-11-21 is green: https://example.test/run/1')
  })

  it('says cancelled, not green, when a job was cancelled and none failed', () => {
    const summary = summarizeNightly({
      ...base,
      jobs: { 'product-core': { result: 'cancelled' } },
      reports: [],
    })
    expect(summary.status).toBe('cancelled')
  })
})
