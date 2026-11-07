// @vitest-environment happy-dom
/**
 * A menu item's own menu on the canvas: Go to leads and Enter takes it, the
 * arrows move through the rest, a disabled entry cannot be taken, and
 * Escape closes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClickMenu } from '@/lib/shared/design/menu-actions'
import { MenuClickMenu } from '../menu-click-menu'

afterEach(cleanup)

const menu: ClickMenu = {
  title: 'Your changelog, called "What is new" in your menu',
  entries: [
    { action: 'go', label: 'Go to What is new', hint: 'Enter' },
    { action: 'rename', label: 'Rename', hint: 'Double-click' },
    { action: 'hide', label: 'Hide from the menu', hint: 'stays open' },
    { action: 'left', label: 'Move left', disabled: true },
    { action: 'right', label: 'Move right' },
  ],
}

async function show() {
  const onAction = vi.fn()
  const onClose = vi.fn()
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  render(<MenuClickMenu menu={menu} anchor={anchor} onAction={onAction} onClose={onClose} />)
  // Focus moves to Go to once the menu is laid out.
  await act(() => new Promise((done) => setTimeout(done, 30)))
  return { onAction, onClose }
}

const active = () => document.activeElement as HTMLElement

describe('MenuClickMenu', () => {
  it('opens on Go to, which Enter takes', async () => {
    const { onAction, onClose } = await show()
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText(menu.title!)).toBeTruthy()
    expect(active().textContent).toContain('Go to What is new')
    fireEvent.keyDown(active(), { key: 'Enter' })
    expect(onAction).toHaveBeenCalledWith('go')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves with the arrow keys', async () => {
    const { onAction } = await show()
    fireEvent.keyDown(active(), { key: 'ArrowDown' })
    expect(active().textContent).toContain('Rename')
    fireEvent.keyDown(active(), { key: 'Enter' })
    expect(onAction).toHaveBeenCalledWith('rename')
  })

  it('shows each hint, and a disabled entry cannot be taken', async () => {
    const { onAction } = await show()
    expect(screen.getByText('Double-click')).toBeTruthy()
    expect(screen.getByText('stays open')).toBeTruthy()
    const left = screen.getByRole('menuitem', { name: /Move left/ })
    expect(left.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(left)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: /Move right/ }))
    expect(onAction).toHaveBeenCalledWith('right')
  })

  it('closes on Escape without doing anything', async () => {
    const { onAction, onClose } = await show()
    fireEvent.keyDown(active(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(onAction).not.toHaveBeenCalled()
  })
})
