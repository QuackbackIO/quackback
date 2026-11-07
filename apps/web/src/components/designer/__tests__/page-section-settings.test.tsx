// @vitest-environment happy-dom
/**
 * A page title's own choices: the changelog's Subscribe and the help center's
 * search. (A page's sections are blocks now, set in the block panel.)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import { PageTitleRows } from '../page-section-settings'

function mount(selection: Selection, start = defaultDesign(), page: DesignerPage = 'changelog') {
  const seen = { design: start }
  function Harness() {
    const [design, setDesign] = useState(start)
    const update = (change: (draft: PortalDesign) => void) => {
      const next = structuredClone(seen.design)
      change(next)
      seen.design = next
      setDesign(next)
    }
    return selection === 'hero' ? (
      <PageTitleRows page={page} design={design} update={update} />
    ) : null
  }
  render(<Harness />)
  return seen
}

afterEach(cleanup)

describe('a page title’s own choices', () => {
  it('places the changelog’s Subscribe', () => {
    const seen = mount('hero', defaultDesign(), 'changelog')
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Subscribe' })).getByRole('radio', {
        name: 'Under',
      })
    )
    expect(seen.design.pages.changelog).toEqual({ subscribe: 'under' })
  })

  it('sizes the help center’s search', () => {
    const seen = mount('hero', defaultDesign(), 'help')
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }))
    expect(seen.design.pages.help).toEqual({ search: 'large' })
  })

  it('marks a choice made with a dot, and resets it to today’s look', () => {
    const seen = mount('hero', defaultDesign(), 'changelog')
    expect(document.querySelector('[data-set-dot]')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Under' }))
    expect(document.querySelector('[data-set-dot]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset subscribe to beside' }))
    expect(seen.design.pages.changelog).toBeUndefined()
    expect(document.querySelector('[data-set-dot]')).toBeNull()
  })

  it('has none for a page without them', () => {
    mount('hero', defaultDesign(), 'roadmap')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})
