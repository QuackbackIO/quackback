/**
 * A TXT value longer than 255 bytes is published as one record of several
 * strings. Some runtimes hand those strings back as separate records, which
 * reads as a value cut short at 255 bytes. The resolver puts them back together
 * without losing a record that only happens to follow a 255-byte one.
 */
import { describe, expect, it } from 'vitest'
import { rejoinTxtChunks } from '../resolver'

const full = 'v=DKIM1; k=rsa; p=' + 'A'.repeat(392)
const first = full.slice(0, 255)
const rest = full.slice(255)
const joined = (records: string[][]) => records.map((r) => r.join(''))

describe('rejoinTxtChunks', () => {
  it('reads one long record handed back as separate records as the whole record', () => {
    const records = rejoinTxtChunks([[first], [rest]])
    expect(records[0]).toEqual([first, rest])
    expect(joined(records)).toContain(full)
    // The first string alone is never offered as a key of its own.
    expect(joined(records)).not.toContain(first)
  })

  it('reads a record of three strings as the whole record', () => {
    const long = 'x'.repeat(600)
    const parts = [long.slice(0, 255), long.slice(255, 510), long.slice(510)]
    expect(joined(rejoinTxtChunks(parts.map((p) => [p])))[0]).toBe(long)
  })

  it('still finds a separate record that follows one of exactly 255 bytes', () => {
    const token = 'qb-domain-verify=abc123'
    const records = rejoinTxtChunks([['x'.repeat(255)], [token]])
    expect(joined(records)).toContain(token)
  })

  it('does not turn a long SPF record into two SPF records', () => {
    const spf = 'v=spf1 ' + 'include:_spf.example.com '.repeat(15) + '~all'
    const records = rejoinTxtChunks([[spf.slice(0, 255)], [spf.slice(255)]])
    const spfs = joined(records).filter((v) => v.startsWith('v=spf1'))
    expect(spfs).toEqual([spf])
  })

  it('returns an answer that kept its record boundaries as it came', () => {
    const records = [[first, rest], ['other=1']]
    expect(rejoinTxtChunks(records)).toEqual(records)
    // Even when a record ends on a full string and another follows it.
    const boundary = [['a', 'b'.repeat(255)], ['other=1']]
    expect(rejoinTxtChunks(boundary)).toEqual(boundary)
  })

  it('leaves separate short records separate', () => {
    const records = [['v=spf1 include:amazonses.com ~all'], ['site-verification=abc']]
    expect(rejoinTxtChunks(records)).toEqual(records)
  })

  it('does not join after a record shorter than a full string', () => {
    const shortish = 'y'.repeat(254)
    expect(rejoinTxtChunks([[shortish], ['other=1']])).toEqual([[shortish], ['other=1']])
  })

  it('keeps a lone record that ends on a full string', () => {
    expect(rejoinTxtChunks([[first]])).toEqual([[first]])
  })

  it('measures strings in bytes, the unit the 255 limit is in', () => {
    // 85 three-byte characters are 255 bytes but only 85 code units.
    const wide = '€'.repeat(85)
    expect(rejoinTxtChunks([[wide], ['tail']])[0]).toEqual([wide, 'tail'])
  })

  it('returns an empty answer unchanged', () => {
    expect(rejoinTxtChunks([])).toEqual([])
  })
})
