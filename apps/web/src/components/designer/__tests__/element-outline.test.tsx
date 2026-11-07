// @vitest-environment happy-dom
/**
 * The picked and pointed elements' tags keep clear of the block's chip, and
 * a live value's badge follows its words, or sits on the corner of its box.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ElementOutlines } from '../element-outline'

afterEach(cleanup)

const room = { width: 1200, height: 800 }
const heading = { left: 100, top: 210, width: 300, height: 24 }
const item = { rect: heading, name: 'Heading · Top posts', kind: 'static' as const, note: 'Static' }

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

  it('puts a live badge after its words, or on the corner of its box', () => {
    const live = {
      rect: { left: 100, top: 300, width: 200, height: 20 },
      source: 'status page',
      settings: '/admin/settings/status',
    }
    const { container } = render(
      <ElementOutlines
        room={room}
        hovered={null}
        picked={null}
        lives={[
          { ...live, words: true },
          { ...live, words: false },
        ]}
        onStep={vi.fn()}
      />
    )
    const [after, corner] = [...container.querySelectorAll<HTMLElement>('[data-live-badge]')]
    expect([after!.style.left, after!.style.top]).toEqual(['306px', '301px'])
    expect([corner!.style.left, corner!.style.top]).toEqual(['294px', '289px'])
  })
})
