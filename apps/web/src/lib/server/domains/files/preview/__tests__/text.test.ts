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

  it('counts lines the way the viewer shows them, whatever ends them', async () => {
    const count = async (s: string) => (await deriveTextPreview(encode(s))).meta.lines
    // A final line break ends the last line; it does not start another.
    expect(await count('a\nb\n')).toBe(2)
    expect(await count('a\nb')).toBe(2)
    expect(await count('a\n\n')).toBe(2)
    expect(await count('\n')).toBe(1)
    // A carriage return on its own breaks a line too, as the viewer reads it.
    expect(await count('a\rb\rc')).toBe(3)
    expect(await count('a\r\rb\r')).toBe(3)
    expect(await count('a\r\nb\r\n')).toBe(2)
  })

  it('shows the first lines of a file whose lines end in carriage returns', async () => {
    const result = await deriveTextPreview(encode('first\rsecond\rthird'))
    expect(result.meta.text).toBe('first\nsecond\nthird')
  })

  it('reads UTF-16 text marked by its byte order mark, as the viewer does', async () => {
    const utf16le = (s: string) => {
      const out = new Uint8Array(2 + s.length * 2)
      out.set([0xff, 0xfe])
      for (let i = 0; i < s.length; i++) out[2 + i * 2] = s.charCodeAt(i)
      return out
    }
    const result = await deriveTextPreview(utf16le('one\r\ntwo\r\nthree\r\n'))
    expect(result.meta.lines).toBe(3)
    expect(result.meta.text).toBe('one\ntwo\nthree')
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
