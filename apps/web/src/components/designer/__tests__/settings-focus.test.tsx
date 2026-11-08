// @vitest-environment happy-dom
/**
 * Where focus goes as the properties change: a part picked from "On this
 * page" puts focus on its panel's heading, and Escape back to the page
 * returns it to the row that opened the part.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { focusAfterStepUp, focusHeading, treeReturnRow } from '../settings-focus'

afterEach(cleanup)

const frame = () => act(() => new Promise((done) => requestAnimationFrame(() => done(null))))

function Panel({ tree = false, sheet = false }) {
  return (
    <aside id="designer-settings" tabIndex={-1} aria-label="Properties">
      <div data-panel-under="">
        <h2>Composer</h2>
        {tree && (
          <ul role="tree" aria-label="On this page">
            <li role="treeitem" aria-selected={false} tabIndex={0} data-tree-row="hero">
              Hero
            </li>
            <li
              role="treeitem"
              aria-selected={false}
              tabIndex={-1}
              data-tree-row="part:hero.home.headline"
            >
              Headline
            </li>
          </ul>
        )}
      </div>
      {sheet && <h2>Theme</h2>}
    </aside>
  )
}

describe('focusHeading', () => {
  it('focuses the heading of the panel under any sheet', async () => {
    render(<Panel sheet />)
    focusHeading()
    await frame()
    const heading = screen.getByRole('heading', { name: 'Composer' })
    expect(document.activeElement).toBe(heading)
    expect(heading.tabIndex).toBe(-1)
  })

  it('falls back to the properties when the panel has no heading', async () => {
    render(<aside id="designer-settings" tabIndex={-1} aria-label="Properties" />)
    focusHeading()
    await frame()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Properties')
  })
})

describe('treeReturnRow', () => {
  it('is the row that opened the part being left, else the part’s own row', () => {
    const origin = { row: 'part:hero.home.headline', selection: 'hero' as const }
    expect(treeReturnRow(origin, 'hero')).toBe('part:hero.home.headline')
    expect(treeReturnRow(origin, 'composer')).toBe('composer')
    expect(treeReturnRow(null, 'home')).toBe('home')
    expect(treeReturnRow(null, null)).toBeNull()
  })
})

describe('focusAfterStepUp', () => {
  it('returns focus to the tree row once Escape is back on the page', async () => {
    render(<Panel tree />)
    focusAfterStepUp({ toPage: true, row: 'part:hero.home.headline' })
    await frame()
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Headline' }))
  })

  it('keeps focus in the properties a level up', async () => {
    render(<Panel tree />)
    focusAfterStepUp({ toPage: false, row: 'hero' })
    await frame()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Properties')
  })

  it('goes to the tree’s own stop where the row is not drawn', async () => {
    render(<Panel tree />)
    focusAfterStepUp({ toPage: true, row: 'page:roadmap' })
    await frame()
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Hero' }))
  })
})
