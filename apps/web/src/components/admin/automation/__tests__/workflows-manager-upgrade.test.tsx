// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouteContext: () => ({ settings: { featureFlags: {}, publicWidgetConfig: {} } }),
}))

vi.mock('@/lib/server/functions/workflows', () => ({
  listWorkflowsFn: vi.fn().mockResolvedValue([]),
  getWorkflowFn: vi.fn(),
  listWorkflowVersionsFn: vi.fn(),
  listRunnableWorkflowsFn: vi.fn(),
  createWorkflowFn: vi.fn(),
  updateWorkflowFn: vi.fn(),
  setWorkflowStatusFn: vi.fn(),
  deleteWorkflowFn: vi.fn(),
  reorderWorkflowsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/workflow-reporting', () => ({
  workflowEffectivenessFn: vi.fn().mockResolvedValue([]),
  workflowRunsFn: vi.fn(),
  workflowRunTimelineFn: vi.fn(),
}))
vi.mock('@/components/admin/upgrade', () => ({
  UpgradeModal: ({ open }: { open: boolean }) =>
    open ? <p>Workflows are a Business feature. Upgrade to Business to enable it.</p> : null,
}))

const { WorkflowsManager } = await import('../workflows-manager')

function renderManager(entitled: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <WorkflowsManager entitled={entitled} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('WorkflowsManager create lock', () => {
  it('opens the upgrade modal instead of creating when locked', async () => {
    const user = userEvent.setup()
    renderManager(false)
    await user.click(await screen.findByRole('button', { name: /New workflow/ }))
    await user.click(await screen.findByText('Create from scratch'))
    expect(screen.getByText(/Workflows are a Business feature/)).toBeTruthy()
  })

  it('does not show the upgrade modal when the plan includes workflows', async () => {
    const user = userEvent.setup()
    renderManager(true)
    await user.click(await screen.findByRole('button', { name: /New workflow/ }))
    expect(screen.getByText('Create from scratch')).toBeTruthy()
    expect(screen.queryByText(/Workflows are a Business feature/)).toBeNull()
  })
})
