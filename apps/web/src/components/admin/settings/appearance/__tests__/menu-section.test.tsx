// @vitest-environment happy-dom
/**
 * The menu in Sections writes the design's menu: a page hidden or renamed, a
 * link once it is whole, and Home's tab while Home is on. A menu that would
 * leave visitors nowhere to start stays out of the draft.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { MenuSection } from '../menu-section'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function renderMenu(start: PortalDesign) {
  const seen = { design: start }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <MenuSection
        design={design}
        gates={ALL_ON}
        update={(change) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  render(<Harness />)
  return seen
}

/** A design whose menu shows only Feedback and Roadmap. */
function twoPages(homeOn = false) {
  const doc = defaultDesign()
  doc.nav.home.on = homeOn
  doc.nav.items = [
    { type: 'feedback', shown: true },
    { type: 'roadmap', shown: true },
  ]
  return doc
}

const shown = (design: PortalDesign) =>
  design.nav.items.flatMap((item) => (item.type !== 'link' && item.shown ? [item.type] : []))

afterEach(cleanup)

describe('the menu in Sections', () => {
  it('hides a page in the draft', () => {
    const seen = renderMenu(twoPages())
    fireEvent.click(screen.getAllByRole('switch')[1]!)
    expect(shown(seen.design)).toEqual(['feedback'])
    expect(portalDesign.safeParse(seen.design).success).toBe(true)
  })

  it('keeps a menu with no page out of the draft while Home is off', () => {
    const seen = renderMenu(twoPages())
    const [feedback, roadmap] = screen.getAllByRole('switch')
    fireEvent.click(roadmap!)
    fireEvent.click(feedback!)
    expect(shown(seen.design)).toEqual(['feedback'])
    expect(screen.getByRole('alert').textContent).toContain('turn Home on')
  })

  it('lets Home stand alone, with its tab and name', () => {
    const seen = renderMenu(twoPages(true))
    const switches = () => screen.getAllByRole('switch')
    fireEvent.click(screen.getByRole('switch', { name: 'Home in the menu' }))
    expect(seen.design.nav.home.tab).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Home tab name' }), {
      target: { value: 'Start' },
    })
    expect(seen.design.nav.home.label).toBe('Start')
    // With Home on, every page can be hidden.
    for (const toggle of switches().slice(1)) fireEvent.click(toggle)
    expect(shown(seen.design)).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes a menu that changed elsewhere, such as a discard', () => {
    const doc = twoPages()
    const { rerender } = render(<MenuSection design={doc} gates={ALL_ON} update={() => {}} />)
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    const elsewhere = defaultDesign()
    rerender(<MenuSection design={elsewhere} gates={ALL_ON} update={() => {}} />)
    expect(screen.getAllByRole('switch')).toHaveLength(elsewhere.nav.items.length)
  })
})
