/**
 * The reason shown on a sync the plan limits pause settled, worded as the
 * plan limits glossary says.
 */
import { describe, expect, it } from 'vitest'
import { SYNC_ERRORS } from '../integration-sync'

describe('the plan_paused sync reason', () => {
  it('reads as the glossary says', () => {
    expect(SYNC_ERRORS.plan_paused).toBe('Paused. Nothing is deleted.')
  })
})
