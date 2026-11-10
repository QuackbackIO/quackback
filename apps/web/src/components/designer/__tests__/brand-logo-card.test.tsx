// @vitest-environment happy-dom
/**
 * The logo a brand match placed, under its reply: the crop it took and the
 * title, with Adjust opening the crop box in a dialog, and a wordmark shown
 * as a full logo or back as the icon and title.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { BrandLogoCard } = await import('../brand-logo-card')

afterEach(cleanup)

const shot = { url: 'blob:a', width: 1000, height: 500 } as never
const logo = (full: boolean) => ({
  shot,
  box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
  full,
  title: 'Paylane',
})

describe('the brand logo card', () => {
  it('shows the icon and title, and offers the full logo instead', () => {
    const onChange = vi.fn()
    render(<BrandLogoCard logo={logo(false)} onChange={onChange} />)
    expect(screen.getByText('Logo · Icon and title')).toBeTruthy()
    expect(screen.getByText('Paylane')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use as full logo' }))
    expect(onChange).toHaveBeenCalledWith({ full: true })
  })

  it('shows a full logo with no title, and offers the icon and title back', () => {
    const onChange = vi.fn()
    render(<BrandLogoCard logo={logo(true)} onChange={onChange} />)
    expect(screen.getByText('Logo · Full logo')).toBeTruthy()
    expect(screen.queryByText('Paylane')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use as icon and title' }))
    expect(onChange).toHaveBeenCalledWith({ full: false })
  })

  it('adjusts the crop in a dialog, saved as one change', async () => {
    const onChange = vi.fn()
    render(<BrandLogoCard logo={logo(false)} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Crop' }))
    const box = await screen.findByRole('group', { name: /Icon crop box/ })
    // Titled "Crop"; how to use the box is its hover help, not a paragraph.
    expect(screen.getByRole('heading', { name: 'Crop' })).toBeTruthy()
    expect(box.getAttribute('title')).toBe('Drag to move, corner to size, arrows to nudge')
    fireEvent.keyDown(box, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].box.x).toBeCloseTo(0.11)
  })
})
