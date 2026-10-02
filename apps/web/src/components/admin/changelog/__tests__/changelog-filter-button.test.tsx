// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangelogFilterButton } from '../changelog-filters'

afterEach(cleanup)

describe('ChangelogFilterButton', () => {
  it('offers the entry statuses under a Filter control', async () => {
    const onStatusChange = vi.fn()
    render(<ChangelogFilterButton status="all" onStatusChange={onStatusChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Scheduled' }))
    expect(onStatusChange).toHaveBeenCalledWith('scheduled')
  })
})
