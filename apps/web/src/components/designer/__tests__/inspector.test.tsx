// @vitest-environment happy-dom
/**
 * The feed's panel owns what the feed does and shows; how every post card
 * and status looks has one home, their element, which a summary row picks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { Inspector } from '../inspector'

afterEach(cleanup)

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function feed(change?: (draft: PortalDesign) => void) {
  const design = defaultDesign()
  design.layout.cards = 'raised'
  change?.(design)
  const update = vi.fn((fn: (draft: PortalDesign) => void) => fn(design))
  const onElement = vi.fn()
  render(
    <Inspector
      selection="feed"
      crumbs={[{ label: 'Feedback' }, { label: 'Feed' }]}
      title="Feed"
      design={design}
      update={update}
      gates={gates}
      onElement={onElement}
    />
  )
  return { design, update, onElement }
}

describe('the feed’s panel', () => {
  it('has no second editor for the post cards’ look, shadow, density or status', () => {
    feed()
    for (const name of ['Cards', 'Shadow', 'Density', 'Status'])
      expect(screen.queryByRole('radiogroup', { name })).toBeNull()
  })

  it('shows the post cards’ and statuses’ looks as rows that pick their elements', () => {
    const { onElement, update } = feed()
    fireEvent.click(screen.getByRole('button', { name: 'Post card look: Raised · Comfortable' }))
    expect(onElement).toHaveBeenLastCalledWith('postCard')
    fireEvent.click(screen.getByRole('button', { name: 'Status look: Dot' }))
    expect(onElement).toHaveBeenLastCalledWith('badge')
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps what the feed does: its sort and what each post card shows', () => {
    const { design } = feed()
    fireEvent.click(screen.getByRole('radio', { name: 'Top' }))
    expect(design.pages.feedback.defaultSort).toBe('top')
    fireEvent.click(screen.getByRole('switch', { name: 'Show tags' }))
    expect(design.layout.postCardHides).toEqual(['tags'])
  })
})
