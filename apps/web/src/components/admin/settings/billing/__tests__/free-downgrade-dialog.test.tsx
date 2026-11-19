// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  preview: vi.fn(),
}))

vi.mock('@/lib/client/queries/billing', () => ({
  fetchDowngradePreviewFn: hoisted.preview,
  billingQueries: { all: ['billing'] },
}))

const { FreeDowngradeDialog } = await import('../free-downgrade-dialog')

const OVER_LIMITS = {
  planName: 'Free',
  featuresDisabled: [],
  info: [],
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
  hoisted.preview.mockReset()
})

afterEach(() => cleanup())

describe('FreeDowngradeDialog', () => {
  it('only reads the preview: a look is not a choice, and closing just closes', async () => {
    hoisted.preview.mockResolvedValue(OVER_LIMITS)
    const onOpenChange = renderDialog()
    await screen.findByText('You have 3 out of 1 boards')
    expect(hoisted.preview).toHaveBeenCalledWith({ data: { planId: 'free' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to plans' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(hoisted.preview).toHaveBeenCalledTimes(1)
  })

  it('shows posts over the cap without blocking the switch', async () => {
    hoisted.preview.mockResolvedValue({
      ...OVER_LIMITS,
      issues: [],
      info: [{ key: 'maxPosts', used: 400, cap: 50, message: 'You have 400 out of 50 posts' }],
    })
    renderDialog()
    await screen.findByText(/You have 400 out of 50 posts/)
    expect(screen.getByRole('button', { name: 'Switch to Free' })).toBeEnabled()
  })

  it('keeps one title while it checks and says why the switch waits', async () => {
    hoisted.preview.mockResolvedValue(OVER_LIMITS)
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Switch to Free' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    await screen.findByText('You have 3 out of 1 boards')
    expect(screen.getByRole('heading', { name: 'Switch to Free' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve issues first' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to plans' })).toBeInTheDocument()
  })

  it('leaves out the clean-up warning when the workspace fits Free', async () => {
    hoisted.preview.mockResolvedValue({ ...OVER_LIMITS, issues: [] })
    renderDialog()
    await screen.findByText('This workspace fits the Free plan.')
    expect(screen.queryByText(/Delete extra resources first/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Free' })).toBeEnabled()
  })
})
