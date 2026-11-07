// @vitest-environment happy-dom
/**
 * The Blocks menu lists the page's blocks as layers: each Home block with
 * its icon and its size on the grid, the picked one checked, and no line of
 * instructions over them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newBlock } from '@/lib/shared/design/home'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BlocksMenu } from '../blocks-menu'

afterEach(cleanup)

describe('BlocksMenu', () => {
  it('lists each block with its icon and size, the picked one checked', async () => {
    const ideas = { ...newBlock('ideas', { w: 6, h: 2 }), id: 'ideas0001' }
    const onPick = vi.fn()
    render(
      <TooltipProvider>
        <BlocksMenu
          parts={[
            { key: 'hero', label: 'Hero' },
            { key: 'block-ideas0001', label: 'Top posts' },
          ]}
          picked="block-ideas0001"
          onPick={onPick}
          blocks={[ideas]}
        />
      </TooltipProvider>
    )
    const trigger = screen.getByRole('button', { name: 'Blocks on this page' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText('Pick one to change it')).toBeNull()
    const [hero, posts] = within(menu).getAllByRole('menuitem')
    expect(hero!.querySelector('[data-block-icon]')).toBeNull()
    expect(posts!.querySelector('[data-block-icon="ideas"]')).not.toBeNull()
    expect(posts!.textContent).toContain('6×2')
    expect(within(posts!).getByLabelText('Picked')).toBeTruthy()
    fireEvent.click(hero!)
    expect(onPick).toHaveBeenCalledWith('hero')
  })
})
