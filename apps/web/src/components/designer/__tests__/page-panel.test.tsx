// @vitest-environment happy-dom
/**
 * The page's own panel, shown with nothing picked: where the title sits, the
 * background and width, the page's parts as rows that pick each, and the
 * way to Theme and Words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { outlineOf, type DesignerPage } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { PagePanel } from '../page-panel'

vi.mock('../page-background-settings', () => ({
  PageBackgroundSection: () => <p>Background settings</p>,
}))

afterEach(cleanup)

function show(page: DesignerPage, change?: (draft: PortalDesign) => void) {
  const start = defaultDesign()
  change?.(start)
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const onSelect = vi.fn()
  const onTheme = vi.fn()
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <PagePanel
        crumbs={[{ label: 'Roadmap' }]}
        title="Roadmap"
        page={page}
        design={design}
        nodes={outlineOf(design, page)}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        onSelect={onSelect}
        onTheme={onTheme}
      />
    )
  }
  render(<Harness />)
  return { seen, onSelect, onTheme }
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

  it('shows the page width as the brand’s, opening Theme at its styles', () => {
    const { onTheme } = show('roadmap', (draft) => void (draft.layout.width = 'wide'))
    fireEvent.click(screen.getByRole('button', { name: 'Brand: Wide' }))
    expect(onTheme).toHaveBeenCalledWith(true)
  })

  it('lists the page’s parts, each picking itself, and leads to Theme and Words', () => {
    const { onSelect, onTheme } = show('roadmap')
    const list = screen.getByRole('list', { name: 'On this page' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Header and menu', 'Hero', 'Board'])
    fireEvent.click(within(list).getByRole('button', { name: 'Hero' }))
    expect(onSelect).toHaveBeenCalledWith('hero')
    fireEvent.click(screen.getByRole('button', { name: 'Words' }))
    expect(onSelect).toHaveBeenCalledWith('site:words')
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
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
