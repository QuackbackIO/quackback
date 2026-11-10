// @vitest-environment happy-dom
/**
 * "On this page", pinned above the picked part's settings: it stays in view
 * whatever is picked, marks the pick, folds, and keeps its height per person.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { insertHomeBlock } from '@/lib/shared/design/home'
import { outlineOf, type DesignerPage, type Selection } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { TreeRow } from '@/lib/shared/design/page-tree'

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'user_1' } }),
}))
// The picked part's own panel is not under test: a stand-in shows which is open.
vi.mock('../picked-settings', () => ({
  PickedSettings: ({ selection }: { selection: string | null }) => (
    <div data-panel-under-stub="">
      <h2>{selection ?? 'Page'} settings</h2>
    </div>
  ),
}))

const { TreePane, TREE_PANE, readTreePane, treePaneKey } = await import('../tree-pane')
const { BuilderSettings } = await import('../builder-settings')
const { panelFor } = await import('@/lib/shared/design/panel-routes')

const KEY = treePaneKey('user_1')

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const ALL = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function show(
  page: DesignerPage,
  {
    change,
    picked = null,
    onPick = vi.fn<(row: TreeRow) => void>(),
  }: {
    change?: (draft: PortalDesign) => void
    picked?: Selection | null
    onPick?: ReturnType<typeof vi.fn<(row: TreeRow) => void>>
  } = {}
) {
  const start = defaultDesign()
  change?.(start)
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const said: string[] = []
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <TreePane
        page={page}
        design={design}
        nodes={outlineOf(design, page)}
        gates={ALL}
        picked={picked}
        onPick={onPick}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        say={(words) => said.push(words)}
      />
    )
  }
  render(<Harness />)
  return { seen, said, onPick }
}

describe('TreePane', () => {
  it('lists the page’s parts as a tree whose rows pick', () => {
    const { onPick } = show('roadmap')
    const tree = screen.getByRole('tree', { name: 'On this page' })
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .filter((item) => item.getAttribute('aria-level') === '1')
        .map((item) => document.getElementById(item.getAttribute('aria-labelledby')!)?.textContent)
    ).toEqual(['Header and menu', 'Hero', 'Board'])
    fireEvent.keyDown(within(tree).getByRole('treeitem', { name: 'Headline' }), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'hero', part: 'hero.roadmap.headline' })
    )
  })

  it('marks the current pick, and only it, as selected, and makes it the tree’s stop', () => {
    show('roadmap', { picked: 'board' })
    const rows = screen.getAllByRole('treeitem')
    const board = screen.getByRole('treeitem', { name: 'Board' })
    expect(board.getAttribute('aria-selected')).toBe('true')
    expect(board.getAttribute('aria-current')).toBe('true')
    expect(board.tabIndex).toBe(0)
    expect(rows.filter((row) => row.getAttribute('aria-selected') === 'true')).toEqual([board])
    expect(screen.getByRole('treeitem', { name: 'Hero' }).getAttribute('aria-selected')).toBe(
      'false'
    )
  })

  it('hides a part from its eye, as one named step', () => {
    const { seen } = show('feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Show Welcome message' }))
    expect(seen.design.pages.feedback.welcome.show).toBe(true)
    expect(seen.labels).toEqual(['Show Welcome message'])
  })

  it('moves a Home block with Alt and the arrows, saying where it went', () => {
    const { seen, said } = show('home', {
      change: (draft) => {
        draft.nav.home.on = true
        insertHomeBlock(draft, 'ideas')
        insertHomeBlock(draft, 'roadmap')
      },
    })
    const first = seen.design.pages.home.blocks[0]!.id
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Top posts' }), {
      key: 'ArrowDown',
      altKey: true,
    })
    expect(seen.design.pages.home.blocks[1]!.id).toBe(first)
    expect(said).toEqual(['Top posts moved to place 2 of 2.'])
  })

  it('folds from its heading, and remembers it folded', () => {
    show('roadmap')
    const fold = screen.getByRole('button', { name: 'On this page' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(readTreePane(localStorage.getItem(KEY)).collapsed).toBe(true)
    cleanup()
    show('roadmap')
    expect(screen.getByRole('button', { name: 'On this page' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
  })

  it('has a labelled divider the arrows and a drag resize, remembered for next time', () => {
    show('roadmap')
    const divider = screen.getByRole('separator', { name: 'Resize On this page' })
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal')
    expect(divider.tabIndex).toBe(0)
    fireEvent.keyDown(divider, { key: 'Home' })
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    expect(divider.getAttribute('aria-valuenow')).toBe(String(TREE_PANE.min + 16))
    fireEvent.pointerDown(divider, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(divider, { clientY: 160, pointerId: 1 })
    fireEvent.pointerUp(divider, { clientY: 160, pointerId: 1 })
    const height = TREE_PANE.min + 16 + 60
    expect(divider.getAttribute('aria-valuenow')).toBe(String(height))
    expect(readTreePane(localStorage.getItem(KEY)).height).toBe(height)
    fireEvent.keyDown(divider, { key: 'End' })
    expect(readTreePane(localStorage.getItem(KEY)).height).toBe(TREE_PANE.max)
    cleanup()
    show('roadmap')
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(String(TREE_PANE.max))
  })

  it('fits its rows up to a cap until the divider moves, never a fixed short box', () => {
    show('roadmap')
    const body = document.getElementById('designer-tree-pane')!
    expect(body.style.height).toBe('')
    expect(body.style.maxHeight).toBe(`min(40vh, ${TREE_PANE.fit}px)`)
  })

  it('shows a shadow cue while rows are hidden below, and above once scrolled', () => {
    show('roadmap')
    const body = document.getElementById('designer-tree-pane')!
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 300 })
    fireEvent.scroll(body)
    expect(body.hasAttribute('data-more-below')).toBe(true)
    expect(body.hasAttribute('data-more-above')).toBe(false)
    body.scrollTop = 200
    fireEvent.scroll(body)
    expect(body.hasAttribute('data-more-above')).toBe(true)
    expect(body.hasAttribute('data-more-below')).toBe(false)
  })

  it('opens as usual when storage is closed', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('closed')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('closed')
    })
    try {
      show('roadmap')
      fireEvent.click(screen.getByRole('button', { name: 'On this page' }))
      expect(
        screen.getByRole('button', { name: 'On this page' }).getAttribute('aria-expanded')
      ).toBe('false')
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })

  it('reads anything unreadable as the usual pane, and clamps the height', () => {
    expect(readTreePane('{nope')).toEqual({ collapsed: false, height: null })
    expect(readTreePane(JSON.stringify({ height: 5 })).height).toBe(TREE_PANE.min)
    expect(readTreePane(JSON.stringify({ height: 9999 })).height).toBe(TREE_PANE.max)
  })
})

describe('BuilderSettings', () => {
  function column(selection: Selection | null) {
    const design = defaultDesign()
    const page: DesignerPage = 'roadmap'
    render(
      <BuilderSettings
        hidden={false}
        shown={{ sheet: null } as never}
        route={panelFor(selection, false, page)}
        panel={{ state: { sheet: null } as never, dispatch: vi.fn(), close: vi.fn() }}
        selection={selection}
        page={page}
        pages={5}
        nodes={outlineOf(design, page)}
        design={design}
        update={vi.fn()}
        gates={ALL}
        locale="en"
        phone={false}
        checks={[]}
        logoUrl={null}
        cssWarnings={[]}
        menu={{ act: vi.fn(), land: vi.fn(), setAdding: vi.fn() } as never}
        pickedBlock={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onTheme={vi.fn()}
        say={vi.fn()}
      />
    )
  }

  it('keeps the tree above the picked part’s settings, with the pick marked', () => {
    column('board')
    const tree = screen.getByRole('tree', { name: 'On this page' })
    const heading = screen.getByRole('heading', { name: 'board settings' })
    expect(tree.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(tree).getByRole('treeitem', { name: 'Board' }).getAttribute('aria-selected')
    ).toBe('true')
    // The tree is outside the part's own panel, so a tree pick still focuses that panel's heading.
    expect(tree.closest('[data-panel-under]')).toBeNull()
    expect(heading.closest('[data-panel-under]')).not.toBeNull()
  })

  it('keeps the tree with the page itself showing, nothing marked', () => {
    column(null)
    const tree = screen.getByRole('tree', { name: 'On this page' })
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .some((row) => row.getAttribute('aria-selected') === 'true')
    ).toBe(false)
  })
})
