/**
 * The builder's icon button: named by its tip, which shows on focus; a
 * disabled one stays focusable, says why, and does nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconButton } from '../icon-button'

afterEach(cleanup)

describe('IconButton', () => {
  it('names itself by its tip and shows it on focus, with no native title', async () => {
    const onClick = vi.fn()
    render(
      <TooltipProvider>
        <IconButton tip="Crop" onClick={onClick}>
          <svg />
        </IconButton>
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Crop' })
    expect(button.hasAttribute('title')).toBe(false)
    fireEvent.focus(button)
    expect((await screen.findAllByText('Crop')).length).toBeGreaterThan(0)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('stays focusable when disabled, and a click does nothing', () => {
    const onClick = vi.fn()
    render(
      <TooltipProvider>
        <IconButton tip="The menu lands here" label="Hide Home" disabled onClick={onClick}>
          <svg />
        </IconButton>
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Hide Home' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
