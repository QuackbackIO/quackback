// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  begin: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/lib/client/queries/billing', () => ({
  beginPlanDowngradeFn: hoisted.begin,
  cancelPlanDowngradeFn: hoisted.cancel,
  billingQueries: { all: ['billing'] },
}))

const { FreeDowngradeDialog } = await import('../free-downgrade-dialog')

const OVER_LIMITS = {
  planName: 'Free',
  featuresDisabled: [],
  issues: [
    {
      key: 'maxBoards',
      used: 3,
      cap: 1,
      message: 'You have 3 out of 1 boards',
      actionLabel: 'Remove 2 boards',
      href: '/admin/settings/boards',
    },
  ],
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FreeDowngradeDialog open onOpenChange={onOpenChange} cancelLabel="Back to plans" />
    </QueryClientProvider>
  )
  return onOpenChange
}

beforeEach(() => {
  hoisted.begin.mockReset()
  hoisted.cancel.mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => cleanup())

describe('FreeDowngradeDialog', () => {
  it('drops the pending switch when closed while blocked, so a look is not a choice', async () => {
    hoisted.begin.mockResolvedValue(OVER_LIMITS)
    const onOpenChange = renderDialog()
    await screen.findByText('You have 3 out of 1 boards')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(hoisted.cancel).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps one title while it checks and says why the switch waits', async () => {
    hoisted.begin.mockResolvedValue(OVER_LIMITS)
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Switch to Free' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    await screen.findByText('You have 3 out of 1 boards')
    expect(screen.getByRole('heading', { name: 'Switch to Free' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve issues first' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to plans' })).toBeInTheDocument()
  })

  it('leaves out the clean-up warning when the workspace fits Free', async () => {
    hoisted.begin.mockResolvedValue({ ...OVER_LIMITS, issues: [] })
    renderDialog()
    await screen.findByText('This workspace fits the Free plan.')
    expect(screen.queryByText(/Delete extra resources first/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Free' })).toBeEnabled()
  })
})
