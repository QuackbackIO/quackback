/**
 * What Quackback AI is told about the design: the steps each choice gives in
 * pixels, that exact values come before the choices, and the exact values'
 * ranges exactly as the design's schema bounds them.
 */
import { describe, expect, it } from 'vitest'
import { tuneSchema } from '@/lib/shared/design/tune'
import { fieldGuide, opsPrompt } from '../design-ai-guide'

const guide = fieldGuide(['welcome'], false)

describe('the field guide', () => {
  it('gives each step in pixels, so a small change need not jump a step', () => {
    expect(guide).toContain('standard (30px), large (48px), display (76px)')
    expect(guide).toContain('subtle (buttons 4px, fields 4px, cards 6px)')
    expect(guide).toContain('section headings 18px')
    expect(guide).toContain('raised (floating on a shadow, without an edge')
  })

  it('names the composer’s widths in the band, and what one left out draws as', () => {
    expect(guide).toContain('pages.home.composerWidth: narrow, medium, wide, full')
    expect(guide).toContain('leave it out for its usual width')
  })

  it('names the hero’s main actions, what each draws, and where a call to action goes', () => {
    expect(guide).toContain(
      "Home's one main action under the headline: composer, search, button, none"
    )
    expect(guide).toContain('only with the help centre on')
    expect(guide).toContain('buttonTo says where it goes: composer or roadmap')
  })

  it('says exact values come before the choices, and what a shared field reaches', () => {
    expect(guide).toContain('An exact value overrides the choice it refines')
    expect(guide).toContain('shape.corners sets the cards, fields and buttons')
  })

  it('states the exact values’ ranges as the schema bounds them', () => {
    const tuneLine = guide.split('\n').find((line) => line.startsWith('tune:'))!
    const groups = tuneSchema.shape
    let checked = 0
    for (const [group, optional] of Object.entries(groups)) {
      const fields = optional.unwrap().shape as Record<string, { unwrap: () => unknown }>
      for (const [key, field] of Object.entries(fields)) {
        const inner = field.unwrap() as { minValue?: number | null; maxValue?: number | null }
        if (typeof inner.minValue !== 'number') continue
        const said = new RegExp(
          `tune\\.${group}\\b[^;]*\\b${key}: (-?[\\d.]+) to (-?[\\d.]+)`
        ).exec(tuneLine)
        expect(said, `${group}.${key}`).not.toBeNull()
        expect([Number(said![1]), Number(said![2])], `${group}.${key}`).toEqual([
          inner.minValue,
          inner.maxValue,
        ])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('gives the model operations and examples, never the document’s paths', () => {
    const prompt = opsPrompt({
      blockTypes: ['welcome'],
      writesCss: false,
      places: { boards: [], roadmaps: [], categories: [] },
    })
    expect(prompt).toContain('Places and sizes are words, never coordinates.')
    expect(prompt).toContain('Put the roadmap first with the updates beside it')
    expect(prompt).not.toContain('pages.home.blocks')
  })
})

describe('exact colours in the guide', () => {
  it('still asks for a hex, though a colour may name a brand role', async () => {
    const { tuneText } = await import('../design-ai-guide')
    const text = tuneText()
    expect(text).toContain('colour: hex}')
    expect(text).toContain('fill: hex, ink: hex')
    expect(text).not.toContain('[object')
  })
})
