import { describe, it, expect } from 'vitest'
import { chunkSource, chunkEmbeddingInput, CHUNK_MAX_CHARS, CHUNK_TARGET_CHARS } from '../chunking'

const paragraph = (word: string, times: number) => `${word} `.repeat(times).trim()

describe('chunkSource', () => {
  it('returns nothing for an empty source', () => {
    expect(chunkSource('')).toEqual([])
    expect(chunkSource('   \n\n  \n')).toEqual([])
  })

  it('keeps offsets exact, so a passage can be placed back in its source', () => {
    const source = `# Billing\n\n${paragraph('alpha', 400)}\n\n## Refunds\n\n${paragraph('beta', 400)}\n\n${paragraph('gamma', 400)}`
    const chunks = chunkSource(source)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(source.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.content)
    }
  })

  it('numbers passages from zero in source order', () => {
    const source = `${paragraph('alpha', 600)}\n\n${paragraph('beta', 600)}`
    const chunks = chunkSource(source)
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i))
    expect(chunks[0].charStart).toBeLessThan(chunks[1].charStart)
  })

  it('carries the nested heading path a passage sits under', () => {
    const source = `# Billing\n\n## Refunds\n\n### Annual plans\n\n${paragraph('alpha', 300)}`
    const [chunk] = chunkSource(source)
    expect(chunk.headingPath).toBe('Billing > Refunds > Annual plans')
  })

  it('pops back out of a subsection when a shallower heading follows', () => {
    const source = `# Billing\n\n## Refunds\n\n${paragraph('alpha', 200)}\n\n## Invoices\n\n${paragraph('beta', 200)}`
    const paths = chunkSource(source).map((c) => c.headingPath)
    expect(paths).toContain('Billing > Refunds')
    expect(paths).toContain('Billing > Invoices')
    expect(paths.some((p) => p?.includes('Refunds > Invoices'))).toBe(false)
  })

  it('never exceeds the ceiling, even for one unbroken paragraph', () => {
    const source = paragraph('alpha', 4000)
    const chunks = chunkSource(source)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
  })

  it('overlaps consecutive passages inside one oversized paragraph', () => {
    const chunks = chunkSource(paragraph('alpha', 4000))
    expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd)
  })

  it('splits an oversized paragraph on a sentence end when there is one', () => {
    const sentence = `${paragraph('alpha', 40)}. `
    const chunks = chunkSource(sentence.repeat(60).trim())
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].content.trimEnd().endsWith('.')).toBe(true)
  })

  it('reaches a fact that sits past character 8,000 of its source', () => {
    const source = `${paragraph('filler', 2000)}\n\n## Zephyr allowance\n\nEvery workspace receives fourteen Zephyr passes.`
    expect(source.indexOf('Zephyr')).toBeGreaterThan(8000)
    const carrier = chunkSource(source).find((c) => c.content.includes('fourteen Zephyr passes'))
    expect(carrier).toBeDefined()
    expect(carrier!.headingPath).toBe('Zephyr allowance')
    expect(carrier!.content.length).toBeLessThan(CHUNK_TARGET_CHARS)
  })

  it('starts a new passage when the heading changes', () => {
    const source = `## One\n\n${paragraph('alpha', 20)}\n\n## Two\n\n${paragraph('beta', 20)}`
    const chunks = chunkSource(source)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].headingPath).toBe('One')
    expect(chunks[1].headingPath).toBe('Two')
  })

  it('is deterministic', () => {
    const source = `# A\n\n${paragraph('alpha', 900)}\n\n## B\n\n${paragraph('beta', 900)}`
    expect(chunkSource(source)).toEqual(chunkSource(source))
  })
})

describe('chunkEmbeddingInput', () => {
  it('prefixes the heading path so a passage carries what it is about', () => {
    expect(chunkEmbeddingInput({ headingPath: 'Billing > Refunds', content: 'Ten days.' })).toBe(
      'Billing > Refunds\n\nTen days.'
    )
  })

  it('is the passage alone when there is no heading', () => {
    expect(chunkEmbeddingInput({ headingPath: null, content: 'Ten days.' })).toBe('Ten days.')
  })
})
