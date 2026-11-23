import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { generateId } from '@quackback/ids'
import { parseCursor, parseLimit, parseOffset, readJsonBody } from '../request'

const post = (body: BodyInit | null) => new Request('http://t/', { method: 'POST', body })

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 })
  })

  it('is undefined when there is no body', async () => {
    expect(await readJsonBody(post(null))).toBeUndefined()
    expect(await readJsonBody(post('  '))).toBeUndefined()
  })

  it('refuses a body that is not JSON as a ValidationError', async () => {
    for (const body of ['{"a":', 'not json', new Uint8Array([0xff, 0xfe, 0x00])]) {
      const attempt = readJsonBody(post(body))
      await expect(attempt).rejects.toBeInstanceOf(ValidationError)
      await expect(attempt).rejects.toThrow('Request body must be valid JSON')
    }
  })
})

describe('parseLimit', () => {
  const url = (query: string) => new URL(`http://t/?${query}`)

  it('falls back when absent and caps at the max', () => {
    expect(parseLimit(url(''))).toBe(20)
    expect(parseLimit(url('limit='))).toBe(20)
    expect(parseLimit(url(''), { fallback: 30 })).toBe(30)
    expect(parseLimit(url('limit=7'))).toBe(7)
    expect(parseLimit(url('limit=500'))).toBe(100)
    expect(parseLimit(url('limit=50'), { max: 20 })).toBe(20)
  })

  it.each(['0', '-1', 'abc', '2.5', '1e2', ' 3'])('refuses limit=%s', (limit) => {
    expect(() => parseLimit(url(`limit=${encodeURIComponent(limit)}`))).toThrow(
      'limit must be a whole number of 1 or more'
    )
  })
})

describe('parseOffset', () => {
  const url = (query: string) => new URL(`http://t/?${query}`)

  it('is 0 when absent and takes any whole number', () => {
    expect(parseOffset(url(''))).toBe(0)
    expect(parseOffset(url('offset=0'))).toBe(0)
    expect(parseOffset(url('offset=40'))).toBe(40)
  })

  it.each(['-1', 'abc', '1.5'])('refuses offset=%s', (offset) => {
    expect(() => parseOffset(url(`offset=${offset}`))).toThrow(ValidationError)
  })
})

describe('parseCursor', () => {
  const url = (query: string) => new URL(`http://t/?${query}`)

  it('is undefined when absent and takes any TypeID', () => {
    expect(parseCursor(url(''))).toBeUndefined()
    expect(parseCursor(url('cursor='))).toBeUndefined()
    const id = generateId('changelog')
    expect(parseCursor(url(`cursor=${id}`))).toBe(id)
    const other = generateId('post')
    expect(parseCursor(url(`cursor=${other}`))).toBe(other)
  })

  it.each(['garbage', 'not-an-id', 'post_123'])('refuses cursor=%s', (cursor) => {
    expect(() => parseCursor(url(`cursor=${cursor}`))).toThrow('Invalid cursor format')
  })
})
