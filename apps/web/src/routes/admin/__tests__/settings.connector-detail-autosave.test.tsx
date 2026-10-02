// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ connectorId: 'conn_1' }),
  }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  Navigate: () => null,
  useNavigate: () => vi.fn(),
}))

const fns = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/server/functions/assistant-connectors', () => ({
  getConnectorFn: fns.get,
  listConnectorsFn: vi.fn(),
  updateConnectorFn: fns.update,
  refreshConnectorFn: vi.fn(),
  deleteConnectorFn: vi.fn(),
  createConnectorFn: vi.fn(),
  startConnectorOAuthFn: vi.fn(),
}))

const { createAutosaveMutationCache } = await import('@/lib/client/autosave')
const { Route } = await import('../settings.connectors_.$connectorId')
const ConnectorPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component

const CONNECTOR = {
  id: 'conn_1',
  name: 'Orders',
  slug: 'orders',
  url: 'https://orders.example.com/mcp',
  authMode: 'bearer',
  hasSecret: true,
  status: 'connected',
  enabled: true,
  assignments: { agent: true, copilot: false },
  toolPolicies: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
  tools: [
    { name: 'lookup_order', description: 'Find an order', group: 'read', policy: 'always' },
    { name: 'refund_order', description: 'Refund an order', group: 'write', policy: 'approval' },
  ],
  toolCount: 2,
  lastSyncedAt: null,
  lastCallAt: null,
  lastError: null,
  lastErrorAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderPage() {
  const queryClient = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <ConnectorPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  fns.get.mockResolvedValue({ builtin: null, connector: CONNECTOR })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('connector detail autosave', () => {
  it('sends an availability toggle as it is flipped', async () => {
    fns.update.mockResolvedValue(CONNECTOR)
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('switch', { name: /Copilot/ }))
    await waitFor(() => expect(fns.update).toHaveBeenCalledTimes(1))
    expect(fns.update).toHaveBeenCalledWith({
      data: { id: 'conn_1', assignments: { agent: true, copilot: true } },
    })
  })

  it('toasts once and keeps the saved value when an availability toggle fails', async () => {
    fns.update.mockRejectedValue(new Error('boom'))
    renderPage()
    const user = userEvent.setup()
    const toggle = await screen.findByRole('switch', { name: /Copilot/ })
    await user.click(toggle)
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    expect(screen.getByRole('switch', { name: /Copilot/ }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('toasts once and keeps the saved policy when a tool policy change fails', async () => {
    fns.update.mockRejectedValue(new Error('boom'))
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('lookup_order')
    await user.click(screen.getAllByRole('radio', { name: 'Never' })[0]!)
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(fns.update).toHaveBeenCalledWith({
      data: {
        id: 'conn_1',
        toolPolicies: {
          groupDefaults: { read: 'always', write: 'approval' },
          tools: { lookup_order: 'never' },
        },
      },
    })
    expect(screen.getAllByRole('radio', { name: 'Allow' })[0]!.getAttribute('aria-checked')).toBe(
      'true'
    )
  })
})
