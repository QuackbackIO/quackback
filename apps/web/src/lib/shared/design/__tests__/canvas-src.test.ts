/**
 * The canvas's first address, which the builder's route starts loading
 * before the builder's code arrives: the same address the canvas then loads,
 * so the browser takes it from its cache.
 */
import { describe, expect, it } from 'vitest'
import { canvasSrc, firstCanvasSrc } from '../canvas-src'
import type { PortalPageGates } from '../paths'
import { defaultDesign } from '../schema'

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

describe('firstCanvasSrc', () => {
  it('is the page someone came from, signed out, in English and the theme shown first', () => {
    const design = defaultDesign()
    expect(firstCanvasSrc(design, ALL_ON, '/roadmap')).toBe(
      '/roadmap?theme=light&preview=true&lang=en&designer=1&visitor=out'
    )
    design.mode = 'dark'
    design.pages.feedback.defaultSort = 'new'
    expect(firstCanvasSrc(design, ALL_ON, '/feedback')).toBe(
      canvasSrc({ page: 'feedback', theme: 'dark', locale: 'en', sort: 'new', visitor: 'out' })
    )
  })

  it('keeps the item someone came from, such as an entry', () => {
    expect(firstCanvasSrc(defaultDesign(), ALL_ON, '/changelog/entry_1')).toBe(
      '/changelog/entry_1?theme=light&preview=true&lang=en&designer=1&visitor=out'
    )
  })

  it('is the first page the builder shows when that page is off, and none for a post it has yet to find', () => {
    const off = firstCanvasSrc(defaultDesign(), { ...ALL_ON, roadmap: false }, '/roadmap')
    expect(off).not.toContain('/roadmap')
    expect(off).toMatch(/^\/[a-z]*\?/)
    expect(firstCanvasSrc(defaultDesign(), ALL_ON, '/b/ideas')).not.toBeNull()
  })
})
