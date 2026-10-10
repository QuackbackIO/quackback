// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SortMenu } from '../sort-menu'

afterEach(cleanup)

const options = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'votes', label: 'Top votes' },
]

describe('SortMenu', () => {
  it('shows the active option in the trigger', () => {
    render(<SortMenu options={options} value="oldest" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sort: Oldest' })).toBeTruthy()
  })

  it('lists every option and marks the active one', async () => {
    const user = userEvent.setup()
    render(<SortMenu options={options} value="newest" onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Sort: Newest' }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getByRole('menuitemradio', { name: 'Newest' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: 'Oldest' }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('calls onChange with the chosen value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SortMenu options={options} value="newest" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Sort: Newest' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Top votes' }))
    expect(onChange).toHaveBeenCalledWith('votes')
  })
})
