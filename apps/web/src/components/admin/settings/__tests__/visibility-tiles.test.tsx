// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VISIBILITY_LABELS, VisibilityTiles } from '../visibility-tiles'

afterEach(cleanup)

const options = [
  { value: 'everyone', title: 'Everyone', description: 'Anyone with the link' },
  { value: 'signedIn', title: 'Signed-in users', description: 'Only people who sign in' },
  { value: 'segments', title: 'Specific segments', description: 'Pick segments', disabled: true },
]

describe('VisibilityTiles', () => {
  it('shows each title and description', () => {
    render(<VisibilityTiles name="v" value="everyone" onChange={() => {}} options={options} />)
    expect(screen.getByText('Signed-in users')).toBeTruthy()
    expect(screen.getByText('Only people who sign in')).toBeTruthy()
  })

  it('exposes the selected tile with aria-checked', () => {
    render(<VisibilityTiles name="v" value="signedIn" onChange={() => {}} options={options} />)
    expect(
      screen.getByRole('radio', { name: /Signed-in users/ }).getAttribute('aria-checked')
    ).toBe('true')
    expect(screen.getByRole('radio', { name: /Everyone/ }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('calls onChange with the clicked tile value', async () => {
    const onChange = vi.fn()
    render(<VisibilityTiles name="v" value="everyone" onChange={onChange} options={options} />)
    await userEvent.setup().click(screen.getByText('Signed-in users'))
    expect(onChange).toHaveBeenCalledWith('signedIn')
  })

  it('cannot choose a disabled option', async () => {
    const onChange = vi.fn()
    render(<VisibilityTiles name="v" value="everyone" onChange={onChange} options={options} />)
    await userEvent.setup().click(screen.getByText('Specific segments'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables every tile when disabled', async () => {
    const onChange = vi.fn()
    render(
      <VisibilityTiles name="v" value="everyone" onChange={onChange} options={options} disabled />
    )
    await userEvent.setup().click(screen.getByText('Signed-in users'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the selected tile for styling', () => {
    render(<VisibilityTiles name="v" value="everyone" onChange={() => {}} options={options} />)
    const tiles = document.querySelectorAll('[data-slot="visibility-tile"]')
    expect(tiles[0].getAttribute('data-selected')).toBe('true')
    expect(tiles[1].getAttribute('data-selected')).toBe('false')
  })

  it('has the shared labels', () => {
    expect(VISIBILITY_LABELS).toEqual({
      everyone: 'Everyone',
      signedIn: 'Signed-in users',
      segments: 'Specific segments',
    })
  })
})
