// @vitest-environment happy-dom
/**
 * Theme's list of the places set differently: nothing with none; closed
 * until opened; grouped by page, by the part's place and by Home block, each
 * with what it sets and its values (phones' and dark mode's tagged), a way
 * to it and a Reset; one whose part is gone flagged, with Remove. It is the
 * same list an element panel's footer shows, so Home blocks' own looks are
 * in it too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { OverridesList } from '../overrides-list'

afterEach(cleanup)

const design = (): PortalDesign =>
  portalDesign.parse({
    ...defaultDesign(),
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          {
            type: 'ideas',
            id: 'abcdefgh',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 2 },
            look: { style: { link: { base: { color: 'ink' } } } },
          },
        ],
      },
    },
    overrides: [
      {
        id: '',
        target: { scope: 'page', page: 'feedback', element: 'button' },
        style: { base: { radius: 2, background: 'accent' } },
      },
      {
        id: '',
        target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
        phone: { base: { height: 44 } },
      },
      {
        id: '',
        target: { scope: 'part', part: 'block.zzzzzzzz.heading', element: 'heading' },
        style: { base: { size: 20 } },
      },
    ],
  })

describe('the overrides list', () => {
  it('is not there with no overrides', () => {
    const { container } = render(<OverridesList design={defaultDesign()} update={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('groups them, says what each changes, flags one whose part is gone, closed until opened', () => {
    const onJump = vi.fn()
    const { container } = render(
      <OverridesList design={design()} update={() => {}} onJump={onJump} />
    )
    expect(container.querySelector('details')!.open).toBe(false)
    expect(container.querySelector('summary')!.textContent).toBe('Set differently4')
    const groups = [...container.querySelectorAll('h4')].map((h) => h.textContent)
    expect(groups).toEqual(['Feedback', 'Hero · Home', 'Gone from the portal', 'Top posts'])
    expect(container.textContent).toContain(
      'Main buttons on Feedback: background Brand colour, corners 2 px'
    )
    expect(container.textContent).toContain('Call to action · Hero: height 44 px (phone)')
    expect(container.textContent).toContain('Links in Top posts: text Text')
    expect(container.textContent).toContain('Its part is gone, so nothing shows it')
    expect(
      screen.getByRole('button', { name: 'Remove Section headings in a block that is gone' })
    ).toBeTruthy()
    // Each name and each Reset is a target at least 24px tall.
    for (const name of ['Call to action · Hero', 'Reset Call to action · Hero'])
      expect(screen.getByRole('button', { name }).className).toMatch(/(^|\s)min-h-6(\s|$)/)
    fireEvent.click(screen.getByRole('button', { name: 'Call to action · Hero' }))
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'part:hero.home.cta:button' })
    )
    // One that is gone has nowhere to go.
    expect(
      screen.queryByRole('button', { name: 'Section headings in a block that is gone' })
    ).toBeNull()
  })

  it('resets one as a named step', () => {
    const box = { design: design(), label: '' as string | undefined }
    render(
      <OverridesList
        design={box.design}
        update={(change, label) => {
          const draft = structuredClone(box.design)
          change(draft)
          box.design = draft
          box.label = label
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset Main buttons on Feedback' }))
    expect(box.design.overrides!.map((o) => o.id)).toEqual([
      'part:hero.home.cta:button',
      'part:block.zzzzzzzz.heading:heading',
    ])
    expect(box.label).toBe('Main buttons on Feedback: reset')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Links in Top posts' }))
    expect(box.design.pages.home.blocks[0]!.look).toBeUndefined()
  })

  it('goes to a Home block’s own look where it is given a way', () => {
    const onBlock = vi.fn()
    render(<OverridesList design={design()} update={() => {}} onBlock={onBlock} />)
    fireEvent.click(screen.getByRole('button', { name: 'Links in Top posts' }))
    expect(onBlock).toHaveBeenCalledWith('abcdefgh')
  })
})
