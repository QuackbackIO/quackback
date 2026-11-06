/**
 * A TXT value longer than 255 bytes is published as one record of several
 * strings. Some runtimes hand those strings back as separate records, which
 * reads as a value cut short at 255 bytes. The resolver puts them back together.
 */
import { describe, expect, it } from 'vitest'
import { rejoinTxtChunks } from '../resolver'

const full = 'v=DKIM1; k=rsa; p=' + 'A'.repeat(392)
const first = full.slice(0, 255)
const rest = full.slice(255)

describe('rejoinTxtChunks', () => {
  it('joins the strings of one long record handed back as separate records', () => {
    const records = rejoinTxtChunks([[first], [rest]])
    expect(records).toEqual([[first, rest]])
    expect(records[0].join('')).toBe(full)
  })

  it('joins a record of three strings', () => {
    const long = 'x'.repeat(600)
    const parts = [long.slice(0, 255), long.slice(255, 510), long.slice(510)]
    expect(rejoinTxtChunks(parts.map((p) => [p])).map((r) => r.join(''))).toEqual([long])
  })

  it('leaves a record already returned as one record of several strings alone', () => {
    expect(rejoinTxtChunks([[first, rest]])).toEqual([[first, rest]])
  })

  it('leaves separate short records separate', () => {
    const records = [['v=spf1 include:amazonses.com ~all'], ['site-verification=abc']]
    expect(rejoinTxtChunks(records)).toEqual(records)
  })

  it('keeps a following record separate when the record before it is shorter than a full string', () => {
    const shortish = 'y'.repeat(254)
    expect(rejoinTxtChunks([[shortish], ['other=1']])).toEqual([[shortish], ['other=1']])
  })

  it('keeps a record that ends on a full string as it is when nothing follows', () => {
    expect(rejoinTxtChunks([[first]])).toEqual([[first]])
  })

  it('measures strings in bytes, the unit the 255 limit is in', () => {
    // 85 three-byte characters are 255 bytes but only 85 code units.
    const wide = '€'.repeat(85)
    expect(rejoinTxtChunks([[wide], ['tail']])).toEqual([[wide, 'tail']])
  })

  it('returns an empty answer unchanged', () => {
    expect(rejoinTxtChunks([])).toEqual([])
  })
})
