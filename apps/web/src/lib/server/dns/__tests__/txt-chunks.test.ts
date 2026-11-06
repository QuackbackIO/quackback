/**
 * A TXT value longer than 255 bytes is published as one record of several
 * strings. Bun hands those strings back as separate records, which reads as a
 * value cut short at 255 bytes. The resolver adds the joined record alongside
 * what came back, so no record that was really there goes missing.
 */
import { describe, expect, it } from 'vitest'
import { rejoinTxtChunks } from '../resolver'

const full = 'v=DKIM1; k=rsa; p=' + 'A'.repeat(392)
const first = full.slice(0, 255)
const rest = full.slice(255)
const joined = (records: string[][]) => records.map((r) => r.join(''))

describe('rejoinTxtChunks', () => {
  it('adds the whole record when one long record came back as separate records', () => {
    expect(joined(rejoinTxtChunks([[first], [rest]]))).toEqual([first, rest, full])
  })

  it('adds the whole record for a record of three strings', () => {
    const long = 'x'.repeat(600)
    const parts = [long.slice(0, 255), long.slice(255, 510), long.slice(510)]
    expect(joined(rejoinTxtChunks(parts.map((p) => [p])))).toContain(long)
  })

  it('keeps a separate 255-byte record and the record after it exactly as they came', () => {
    const dmarc = 'v=DMARC1; p=reject; rua=mailto:' + 'r'.repeat(255 - 31)
    expect(Buffer.byteLength(dmarc)).toBe(255)
    const token = 'qb-domain-verify=abc123'
    const values = joined(rejoinTxtChunks([[dmarc], [token]]))
    expect(values).toContain(dmarc)
    expect(values).toContain(token)
  })

  it('returns an answer that kept its record boundaries as it came', () => {
    const records = [[first, rest], ['other=1']]
    expect(rejoinTxtChunks(records)).toEqual(records)
  })

  it('leaves separate short records as they came', () => {
    const records = [['v=spf1 include:amazonses.com ~all'], ['site-verification=abc']]
    expect(rejoinTxtChunks(records)).toEqual(records)
  })

  it('adds nothing after a record shorter than a full string', () => {
    const shortish = 'y'.repeat(254)
    expect(rejoinTxtChunks([[shortish], ['other=1']])).toEqual([[shortish], ['other=1']])
  })

  it('adds nothing for a lone record that ends on a full string', () => {
    expect(rejoinTxtChunks([[first]])).toEqual([[first]])
  })

  it('measures strings in bytes, the unit the 255 limit is in', () => {
    // 85 three-byte characters are 255 bytes but only 85 code units.
    const wide = '€'.repeat(85)
    expect(joined(rejoinTxtChunks([[wide], ['tail']]))).toContain(wide + 'tail')
  })

  it('returns an empty answer unchanged', () => {
    expect(rejoinTxtChunks([])).toEqual([])
  })
})
