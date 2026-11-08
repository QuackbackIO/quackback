// @vitest-environment happy-dom
/** While the page loads, the canvas draws the outline of the page's parts. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { insertHomeBlock } from '@/lib/shared/design/home'
import { outlineOf } from '@/lib/shared/design/outline'
import { defaultDesign } from '@/lib/shared/design/schema'
import { CanvasSkeleton, skeletonOf } from '../canvas-skeleton'

afterEach(cleanup)

describe('skeletonOf', () => {
  it('is the header, the hero, then each of the page’s own parts', () => {
    const design = defaultDesign()
    expect(skeletonOf(outlineOf(design, 'feedback')).map((part) => part.kind)).toEqual([
      'header',
      'hero',
      'part',
      'part',
      'part',
      'part',
    ])
    expect(skeletonOf(outlineOf(design, 'post')).map((part) => part.kind)).toEqual(['header'])
  })

  it('draws Home’s blocks at their width on the grid', () => {
    const design = defaultDesign()
    design.nav.home.on = true
    const a = insertHomeBlock(design, 'ideas')
    insertHomeBlock(design, 'roadmap')
    a.grid = { ...a.grid, w: 6, h: 4 }
    const parts = skeletonOf(outlineOf(design, 'home'), design.pages.home.blocks)
    expect(parts.map((part) => part.kind)).toEqual(['header', 'hero', 'block', 'block'])
    expect(parts[2]).toMatchObject({ span: 6, rows: 4 })
  })
})

describe('CanvasSkeleton', () => {
  it('draws one shape per part, hidden from screen readers', () => {
    const design = defaultDesign()
    const { container } = render(
      <CanvasSkeleton parts={skeletonOf(outlineOf(design, 'roadmap'))} />
    )
    const root = container.querySelector('[data-canvas-skeleton]')!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelectorAll('[data-skeleton-part]')).toHaveLength(3)
  })
})
