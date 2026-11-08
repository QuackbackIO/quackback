// @vitest-environment happy-dom
/** The boxes the builder outlines on the canvas: a block by its section, the logo by its part. */
import { describe, expect, it } from 'vitest'
import { blockElement } from '../use-frame-rects'

describe('blockElement', () => {
  it('finds a block by its section, and the logo, its own element, by its part', () => {
    document.body.innerHTML = `
      <header data-qb-section="header">
        <a data-qb-part="logo" data-qb-menu="logo">Acme</a>
      </header>
      <div data-qb-section="feed"></div>`
    expect(blockElement(document, 'feed')?.getAttribute('data-qb-section')).toBe('feed')
    expect(blockElement(document, 'logo')?.getAttribute('data-qb-part')).toBe('logo')
    expect(blockElement(document, 'nothing')).toBeNull()
  })
})
