// @vitest-environment happy-dom
/**
 * The picked and pointed elements' tags keep clear of the block's chip, and
 * say what an element is and where, "Headline · Hero", with no jargon: a
 * database glyph marks the workspace's own content, and nothing else does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ElementOutlines } from '../element-outline'

afterEach(cleanup)

const room = { width: 1200, height: 800 }
const heading = { left: 100, top: 210, width: 300, height: 24 }
const item = { rect: heading, name: 'Heading · Top posts', kind: 'static' as const, editable: true }

const tagTop = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-element-hover-tag]')!.parentElement!.style.top

describe('ElementOutlines', () => {
  it('puts the tag below an element at the top of its block, where the block’s chip sits', () => {
    const under = render(
      <ElementOutlines
        room={room}
        hovered={item}
        picked={null}
        block={{ left: 90, top: 200, width: 600, height: 300 }}
        onStep={vi.fn()}
      />
    )
    expect(tagTop(under.container)).toBe('236px')
    cleanup()
    const clear = render(
      <ElementOutlines
        room={room}
        hovered={item}
        picked={null}
        block={{ left: 90, top: 100, width: 600, height: 400 }}
        onStep={vi.fn()}
      />
    )
    expect(tagTop(clear.container)).toBe('190px')
  })

  it('names the element and where it is, with no kind tag', () => {
    const { container } = render(
      <ElementOutlines
        room={room}
        hovered={null}
        picked={{ ...item, name: 'Headline · Hero' }}
        onStep={vi.fn()}
      />
    )
    const tag = screen.getByRole('button', { name: /^Headline · Hero/ })
    expect(tag.textContent).toBe('Headline · Hero')
    expect(container.querySelector('[data-kind-note]')).toBeNull()
    expect(container.querySelector('[data-content-glyph]')).toBeNull()
    expect(container.textContent).not.toMatch(/Static|Dynamic|style only|Live/)
  })

  it('marks the workspace’s own content with a database glyph', () => {
    const { container } = render(
      <ElementOutlines
        room={room}
        hovered={null}
        picked={{ ...item, name: 'Post title · Top posts', kind: 'dynamic', editable: false }}
        onStep={vi.fn()}
      />
    )
    expect(container.querySelector('[data-content-glyph]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Post title · Top posts, your data/ })).toBeTruthy()
  })

  it('shows a long element name in full on hover, since the tag cuts it short', () => {
    const { container } = render(
      <ElementOutlines room={room} hovered={item} picked={null} block={null} onStep={vi.fn()} />
    )
    expect(container.querySelector('[title="Heading · Top posts"]')).toHaveClass('truncate')
  })
})
