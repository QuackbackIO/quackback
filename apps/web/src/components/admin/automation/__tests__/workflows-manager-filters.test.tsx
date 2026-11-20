// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { settings: { featureFlags: {}, publicWidgetConfig: {} } }
    return opts?.select ? opts.select(context as never) : context
  },
}))

const base = {
  sortOrder: 0,
  triggerType: 'conversation.created',
  triggerSettings: {},
  graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

vi.mock('@/lib/server/functions/workflows', () => ({
  listWorkflowsFn: vi.fn().mockResolvedValue([
    { ...base, id: 'w1', name: 'Welcome tour', class: 'customer_facing', status: 'live' },
    { ...base, id: 'w2', name: 'Billing triage', class: 'customer_facing', status: 'draft' },
    { ...base, id: 'w3', name: 'Nightly tidy', class: 'background', status: 'live' },
  ]),
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

const { WorkflowsManager } = await import('../workflows-manager')

afterEach(cleanup)

function renderManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <WorkflowsManager />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('WorkflowsManager toolbar', () => {
  it('has a search box and one Filter button instead of status and type selects', async () => {
    renderManager()
    await screen.findByText('Welcome tour')
    expect(screen.getByRole('textbox', { name: 'Search workflows…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('narrows the list to the picked status and lets the chip clear it', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Billing triage')
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(await screen.findByRole('button', { name: 'Draft' }))
    expect(screen.getByText('Billing triage')).toBeInTheDocument()
    expect(screen.queryByText('Welcome tour')).toBeNull()
    expect(screen.queryByText('Nightly tidy')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Remove Status Draft filter/ }))
    expect(await screen.findByText('Welcome tour')).toBeInTheDocument()
  })

  it('renders at form width under the standard page header', async () => {
    const { container } = renderManager()
    await screen.findByText('Welcome tour')
    expect(container.querySelector('[data-settings-page-body]')?.className).toContain('max-w-3xl')
    expect(screen.getByRole('heading', { level: 1, name: 'Workflows' })).toBeInTheDocument()
  })
})
