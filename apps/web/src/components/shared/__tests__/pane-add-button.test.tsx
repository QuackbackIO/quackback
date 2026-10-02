// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PaneAddButton } from '../pane-add-button'

afterEach(cleanup)

describe('PaneAddButton', () => {
  it('is labelled for assistive tech', () => {
    render(<PaneAddButton label="New board" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy()
  })

  it('calls onClick', () => {
    const onClick = vi.fn()
    render(<PaneAddButton label="New board" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'New board' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is a 20px control', () => {
    render(<PaneAddButton label="New board" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'New board' }).className).toContain('size-5')
  })
})
