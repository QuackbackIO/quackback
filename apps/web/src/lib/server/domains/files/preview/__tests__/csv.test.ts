import { describe, it, expect } from 'vitest'
import { deriveCsvPreview } from '../csv'

const encode = (s: string) => new TextEncoder().encode(s)

describe('deriveCsvPreview', () => {
  it('reads a 6x8 head and counts every row in the file', async () => {
    const lines = ['id,name,email,plan,seats,mrr,country,created,notes,extra']
    for (let i = 1; i <= 1000; i++) {
      lines.push(
        `${i},"Customer, ${i}",c${i}@example.com,pro,${i % 9},${i * 10},NZ,2026-01-01,ok,x`
      )
    }
    const result = await deriveCsvPreview(encode(lines.join('\n') + '\n'))
    expect(result.status).toBe('ready')
    expect(result.meta.rows).toBe(1001)
    const head = result.meta.head!
    expect(head).toHaveLength(6)
    expect(head[0]).toEqual(['id', 'name', 'email', 'plan', 'seats', 'mrr', 'country', 'created'])
    expect(head[1]![1]).toBe('Customer, 1')
    expect(result.excerpt).toContain('c1@example.com')
  })

  it('counts a last line without a trailing newline', async () => {
    const result = await deriveCsvPreview(encode('a,b\r\n1,2\r\n3,4'))
    expect(result.meta.rows).toBe(3)
    expect(result.meta.head).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('reads tab-separated values and truncates long cells', async () => {
    const result = await deriveCsvPreview(encode(`k\tv\nlong\t${'y'.repeat(100)}\n`))
    expect(result.meta.head![0]).toEqual(['k', 'v'])
    expect(result.meta.head![1]![1]!.length).toBeLessThanOrEqual(40)
    expect(result.meta.head![1]![1]!.startsWith('yyyy')).toBe(true)
  })

  it('keeps the excerpt inside the cap for a large file', async () => {
    const row = 'abcdefghij,'.repeat(10) + '\n'
    const result = await deriveCsvPreview(encode(row.repeat(50_000)))
    expect(result.meta.rows).toBe(50_000)
    expect(result.excerpt!.length).toBeLessThanOrEqual(20_000)
  })
})
