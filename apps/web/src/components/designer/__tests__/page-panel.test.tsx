// @vitest-environment happy-dom
/**
 * The page's own panel, shown with nothing picked: where the title sits, the
 * background and width, the page's parts as a tree that picks, hides and
 * moves them, and the way to Theme.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { PagePanel } from '../page-panel'

/** A target at least 24px tall, as small text links and buttons are given. */
const at24 = (el: Element) => expect(el.className).toMatch(/(^|\s)(min-h-6|size-6|min-h-7)(\s|$)/)

vi.mock('../page-background-settings', () => ({
  PageBackgroundSection: () => <p>Background settings</p>,
}))

afterEach(cleanup)

function show(
  page: DesignerPage,
  change?: (draft: PortalDesign) => void,
  extra: Partial<Parameters<typeof PagePanel>[0]> = {}
) {
  const start = defaultDesign()
  change?.(start)
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const onTheme = vi.fn()
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <PagePanel
        crumbs={[{ label: 'Roadmap' }]}
        title="Roadmap"
        page={page}
        design={design}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        onTheme={onTheme}
        {...extra}
      />
    )
  }
  render(<Harness />)
  return { seen, onTheme }
}

describe('PagePanel', () => {
  it('puts the title in the hero and back, with a dot and Reset while it is set', () => {
    const { seen } = show('roadmap')
    const title = screen.getByRole('radiogroup', { name: 'Title' })
    expect(document.querySelector('[data-set-dot]')).toBeNull()
    fireEvent.click(within(title).getByRole('radio', { name: 'In the hero' }))
    expect(seen.design.layout.pageTitles).toBe('band')
    expect(document.querySelector('[data-set-dot]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Reset title/ }))
    expect(seen.design.layout.pageTitles).toBeUndefined()
    expect(seen.labels).toEqual(['Page titles', 'Page titles'])
  })

  it('has no title row on a page whose title is always in the hero', () => {
    show('feedback')
    expect(screen.queryByRole('radiogroup', { name: 'Title' })).toBeNull()
  })

  it('says whose background the page shows, and opens its settings in place', () => {
    show('roadmap')
    const row = screen.getByRole('button', { name: 'Background' })
    expect(row.textContent).toBe('Every page: Page colour')
    expect(screen.queryByText('Background settings')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Background settings')).toBeTruthy()
  })

  it('shows the page width as Theme’s, opening Theme at its styles', () => {
    const { onTheme } = show('roadmap', (draft) => void (draft.layout.width = 'wide'))
    // Where it comes from, said by its ⓘ.
    expect(screen.getByRole('button', { name: 'From Theme' })).toBeTruthy()
    expect(screen.queryByText(/Brand: /)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Wide' }))
    expect(onTheme).toHaveBeenCalledWith(true)
  })

  it('leaves the page’s parts to the pinned tree, and leads to Theme', () => {
    const { onTheme } = show('roadmap')
    expect(screen.queryByRole('tree')).toBeNull()
    // Every page's Theme is a row as wide as the panel.
    const theme = screen.getByRole('button', { name: 'Theme' })
    at24(theme)
    expect(theme.className).toContain('w-full')
    fireEvent.click(theme)
    expect(onTheme).toHaveBeenCalledWith(false)
  })

  it('places the changelog’s Subscribe as a page choice', () => {
    const { seen } = show('changelog')
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Subscribe' })).getByRole('radio', {
        name: 'Under',
      })
    )
    expect(seen.design.pages.changelog).toEqual({ subscribe: 'under' })
  })
})
