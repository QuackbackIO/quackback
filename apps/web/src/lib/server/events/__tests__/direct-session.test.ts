/**
 * The pooled-DSN heuristic.
 *
 * Both directions matter and for different reasons: a miss means the relay's
 * likeliest misconfiguration goes unnamed until the boot round trip catches it,
 * and a false positive means a self-hoster with an unusual hostname reads an
 * error telling them to change a field that is already correct.
 */
import { describe, expect, it } from 'vitest'
import { looksPooled } from '../direct-session'

describe('looksPooled', () => {
  it('names the pooled endpoint', () => {
    expect(
      looksPooled('postgresql://u@ep-tiny-poetry-auqd4saj-pooler.c-10.us-east-1.aws.neon.tech/db')
    ).toBe(true)
    expect(looksPooled('postgresql://u@db.pooler.internal:5432/db')).toBe(true)
  })

  it('leaves the direct endpoint alone', () => {
    expect(
      looksPooled('postgresql://u@ep-tiny-poetry-auqd4saj.c-10.us-east-1.aws.neon.tech/db')
    ).toBe(false)
    expect(looksPooled('postgresql://postgres:pw@localhost:5432/quackback')).toBe(false)
  })

  it('does not fire on a host that merely contains "pool"', () => {
    // A broad match would flag this, and a warning that cries wolf gets muted.
    expect(looksPooled('postgresql://u@db.pool-a.internal:5432/db')).toBe(false)
    expect(looksPooled('postgresql://u@carpool.example.com/db')).toBe(false)
  })

  it('is not an input validator — an unparseable DSN is somebody else problem', () => {
    expect(looksPooled('not a url')).toBe(false)
  })
})
