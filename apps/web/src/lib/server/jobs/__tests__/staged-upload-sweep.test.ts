/**
 * The staged upload sweep is a daily schedule, gated on there being an upload
 * a day old, so a workspace with nothing staged writes no job row.
 */
import { describe, expect, it } from 'vitest'
import { JOB_DEFINITIONS } from '../definitions'

describe('staged-upload-sweep', () => {
  const def = JOB_DEFINITIONS.find((d) => d.name === 'staged-upload-sweep')

  it('runs once a day, gated, with retries', () => {
    expect(def).toBeDefined()
    expect(def!.cron).toMatch(/^\d+ \d+ \* \* \*$/)
    expect(def!.cronEnabled).toBeTypeOf('function')
    expect(def!.maxAttempts).toBe(3)
  })

  it('resolves to the sweep handler', async () => {
    expect(await def!.handler()).toBeTypeOf('function')
  })
})
