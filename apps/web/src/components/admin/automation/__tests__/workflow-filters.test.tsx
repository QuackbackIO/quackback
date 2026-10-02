// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowFilters } from '../workflow-filters'

afterEach(cleanup)

const STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'live', label: 'Live' },
]
const TYPES = [
  { id: 'customer_facing', label: 'Customer-facing' },
  { id: 'background', label: 'Background' },
]

function setup(props: Partial<React.ComponentProps<typeof WorkflowFilters>> = {}) {
  const onStatus = vi.fn()
  const onType = vi.fn()
  render(
    <WorkflowFilters
      statuses={STATUSES}
      types={TYPES}
      status={null}
      type={null}
      onStatus={onStatus}
      onType={onType}
      {...props}
    />
  )
  return { onStatus, onType }
}

describe('WorkflowFilters', () => {
  it('offers one Filter button and no active chips while nothing is filtered', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it('applies a status picked from the Filter menu', async () => {
    const { onStatus } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Live' }))
    expect(onStatus).toHaveBeenCalledWith('live')
  })

  it('applies a type picked from the Filter menu', async () => {
    const { onType } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Background' }))
    expect(onType).toHaveBeenCalledWith('background')
  })

  it('shows an active filter as a chip that clears itself', async () => {
    const { onStatus } = setup({ status: 'live' })
    expect(screen.getByText('Live')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Remove Status Live filter/ }))
    expect(onStatus).toHaveBeenCalledWith(null)
  })
})
