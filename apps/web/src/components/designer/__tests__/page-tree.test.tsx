// @vitest-environment happy-dom
/**
 * "On this page" as a tree: one tab stop, arrows to move, Left and Right to
 * close and open, Enter to pick, Alt+Up and Down to reorder, and an eye and
 * Move buttons on the rows that can hide or move.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { TreeRow } from '@/lib/shared/design/page-tree'
import { PageTree } from '../page-tree'

afterEach(cleanup)

const block = (id: string, label: string): TreeRow => ({
  id: `block-${id}`,
  key: `block-${id}`,
  label,
  level: 2,
})

function rowsOf(order: string[]): TreeRow[] {
  const names: Record<string, string> = { a: 'Top posts', b: 'Roadmap', c: 'Updates' }
  return [
    {
      id: 'header',
      key: 'header',
      label: 'Header and menu',
      level: 1,
      children: [
        { id: 'logo', key: 'logo', label: 'Logo', level: 2 },
        {
          id: 'page:roadmap',
          key: 'page:roadmap',
          label: 'Roadmap',
          level: 2,
          menu: 'roadmap',
          hide: { shown: true, locked: false },
        },
        {
          id: 'page:feedback',
          key: 'page:feedback',
          label: 'Feedback',
          level: 2,
          menu: 'feedback',
          hide: { shown: true, locked: true },
        },
      ],
    },
    { id: 'hero', key: 'hero', label: 'Hero', level: 1 },
    {
      id: 'home',
      key: 'home',
      label: 'Blocks',
      level: 1,
      children: order.map((id, at) => ({
        ...block(id, names[id]!),
        move: { up: at > 0, down: at < order.length - 1 },
      })),
    },
  ]
}

function show() {
  const onPick = vi.fn()
  const onShown = vi.fn()
  const moves: Array<[string, number]> = []
  function Harness() {
    const [order, setOrder] = useState(['a', 'b', 'c'])
    return (
      <PageTree
        label="On this page"
        rows={rowsOf(order)}
        onPick={onPick}
        onShown={onShown}
        onMove={(row, by) => {
          moves.push([row.id, by])
          const id = row.id.slice('block-'.length)
          const at = order.indexOf(id)
          const next = [...order]
          next.splice(at, 1)
          next.splice(at + by, 0, id)
          setOrder(next)
        }}
      />
    )
  }
  render(<Harness />)
  return { onPick, onShown, moves }
}

const item = (name: string) => screen.getByRole('treeitem', { name })
const key = (target: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(target, { key, ...init })

describe('PageTree', () => {
  it('is a tree with levels, the header closed and the rest open, and one tab stop', () => {
    show()
    const tree = screen.getByRole('tree', { name: 'On this page' })
    const items = within(tree).getAllByRole('treeitem')
    expect(items.map((each) => each.getAttribute('aria-level'))).toEqual([
      '1',
      '1',
      '1',
      '2',
      '2',
      '2',
    ])
    expect(item('Header and menu').getAttribute('aria-expanded')).toBe('false')
    expect(item('Blocks').getAttribute('aria-expanded')).toBe('true')
    expect(item('Hero').hasAttribute('aria-expanded')).toBe(false)
    expect(items.filter((each) => each.tabIndex === 0)).toEqual([item('Header and menu')])
  })

  it('moves with the arrows, opens with Right, closes with Left and goes to the parent', () => {
    show()
    const header = item('Header and menu')
    header.focus()
    key(header, 'ArrowRight')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    key(header, 'ArrowRight')
    expect(document.activeElement).toBe(item('Logo'))
    expect(item('Logo').tabIndex).toBe(0)
    expect(header.tabIndex).toBe(-1)
    key(item('Logo'), 'ArrowLeft')
    expect(document.activeElement).toBe(header)
    key(header, 'ArrowLeft')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    key(header, 'ArrowDown')
    expect(document.activeElement).toBe(item('Hero'))
    key(item('Hero'), 'End')
    expect(document.activeElement).toBe(item('Updates'))
    key(item('Updates'), 'Home')
    expect(document.activeElement).toBe(header)
    key(header, 'ArrowUp')
    expect(document.activeElement).toBe(header)
  })

  it('picks a row with Enter or a click', () => {
    const { onPick } = show()
    key(item('Hero'), 'Enter')
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'hero' }))
    fireEvent.click(within(item('Roadmap')).getByText('Roadmap'))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'block-b' }))
  })

  it('reorders a movable row with Alt and the arrows, keeping focus on it', async () => {
    const { moves } = show()
    const roadmap = item('Roadmap')
    roadmap.focus()
    key(roadmap, 'ArrowDown', { altKey: true })
    expect(moves).toEqual([['block-b', 1]])
    await act(() => new Promise((done) => requestAnimationFrame(() => done(null))))
    const blocks = within(item('Blocks'))
      .getAllByRole('treeitem')
      .map((each) => each.id)
    expect(blocks.map((id) => id.split('-').pop())).toEqual(['a', 'c', 'b'])
    expect(document.activeElement).toBe(item('Roadmap'))
    // At the end it goes no further, and a row that cannot move does nothing.
    key(item('Roadmap'), 'ArrowDown', { altKey: true })
    key(item('Hero'), 'ArrowUp', { altKey: true })
    expect(moves).toHaveLength(1)
  })

  it('moves with its buttons, the end ones off', () => {
    const { moves } = show()
    expect(screen.getByRole('button', { name: 'Move Top posts up' })).toHaveProperty(
      'disabled',
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move Top posts down' }))
    expect(moves).toEqual([['block-a', 1]])
  })

  it('hides and shows with the eye, which stays put on a part that has to stay', () => {
    const { onShown } = show()
    key(item('Header and menu'), 'ArrowRight')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Roadmap' }))
    expect(onShown).toHaveBeenCalledWith(expect.objectContaining({ id: 'page:roadmap' }), false)
    expect(screen.getByRole('button', { name: 'Hide Feedback' })).toHaveProperty('disabled', true)
  })

  it('lets Tab reach the focused row’s buttons only', () => {
    show()
    const roadmap = item('Roadmap')
    fireEvent.focus(roadmap)
    roadmap.focus()
    const own = within(roadmap).getAllByRole('button')
    expect(own.every((button) => button.tabIndex === 0)).toBe(true)
    const other = within(item('Updates')).getAllByRole('button')
    expect(other.every((button) => button.tabIndex === -1)).toBe(true)
  })
})
