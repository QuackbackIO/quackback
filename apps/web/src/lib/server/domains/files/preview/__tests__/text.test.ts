import { describe, it, expect } from 'vitest'
import { deriveTextPreview } from '../text'

const encode = (s: string) => new TextEncoder().encode(s)

describe('deriveTextPreview', () => {
  it('counts lines and keeps the first twelve for the card', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
    const result = await deriveTextPreview(encode(lines.join('\n') + '\n'))
    expect(result.status).toBe('ready')
    expect(result.meta.lines).toBe(40)
    expect(result.meta.text).toBe(lines.slice(0, 12).join('\n'))
  })

  it('counts a last line without a newline and handles CRLF', async () => {
    const result = await deriveTextPreview(encode('first\r\nsecond\r\nthird'))
    expect(result.meta.lines).toBe(3)
    expect(result.meta.text).toBe('first\nsecond\nthird')
  })

  it('truncates long lines on the card and keeps indentation', async () => {
    const result = await deriveTextPreview(encode(`  indented\n${'z'.repeat(5000)}\n`))
    const [first, second] = result.meta.text!.split('\n')
    expect(first).toBe('  indented')
    expect(second!.length).toBeLessThanOrEqual(160)
  })

  it('normalizes whitespace in the excerpt and caps it', async () => {
    const result = await deriveTextPreview(encode('a  \t b\n\n\n\nc' + '\nword'.repeat(10_000)))
    expect(result.excerpt!.startsWith('a b\n\nc\nword')).toBe(true)
    expect(result.excerpt!.length).toBeLessThanOrEqual(20_000)
  })

  it('drops characters a database text column cannot hold', async () => {
    const bytes = new Uint8Array([...encode('ok'), 0, ...encode('\u0007fine')])
    const result = await deriveTextPreview(bytes)
    expect(result.meta.text).toBe('okfine')
    expect(result.excerpt).toBe('okfine')
  })

  it('never splits an emoji when truncating', async () => {
    const line = 'a'.repeat(158) + '😀😀'
    const result = await deriveTextPreview(encode(line))
    expect(result.meta.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
