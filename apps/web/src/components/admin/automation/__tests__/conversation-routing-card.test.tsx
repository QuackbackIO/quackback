// @vitest-environment happy-dom
/**
 * The "Auto-assign new conversations" switch on the Workflows page: shown to
 * routing.manage holders only, read from and saved through the routing
 * server functions (which require routing.manage, not settings.manage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const fetchRouting = vi.fn()
const updateRouting = vi.fn()
/** The viewer's permissions. */
const held = { permissions: [] as string[] }

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useHasPermission: (permission: string) => held.permissions.includes(permission),
}))
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  fetchConversationRoutingFn: (...args: unknown[]) => fetchRouting(...args),
  updateConversationRoutingFn: (...args: unknown[]) => updateRouting(...args),
}))

const { ConversationRoutingCard } = await import('../conversation-routing-card')

let client: QueryClient

function renderCard() {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <ConversationRoutingCard />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  fetchRouting.mockReset()
  updateRouting.mockReset()
  fetchRouting.mockResolvedValue({ enabled: true, strategy: 'auto_assign_active' })
  updateRouting.mockResolvedValue({ enabled: false, strategy: 'auto_assign_active' })
  held.permissions = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(cleanup)

describe('ConversationRoutingCard', () => {
  it('shows the saved switch to a routing.manage holder without settings.manage', async () => {
    held.permissions = ['routing.manage', 'workflow.manage']
    renderCard()
    const toggle = await screen.findByRole('switch', { name: 'Auto-assign new conversations' })
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(fetchRouting).toHaveBeenCalledTimes(1)
  })

  it('saves a flip as an autosave mutation', async () => {
    held.permissions = ['routing.manage']
    renderCard()
    const toggle = await screen.findByRole('switch', { name: 'Auto-assign new conversations' })
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateRouting).toHaveBeenCalledWith({
        data: { enabled: false, strategy: 'auto_assign_active' },
      })
    )
    expect(client.getMutationCache().getAll()[0].meta).toEqual({ autosave: true })
  })

  it('renders nothing and reads nothing without routing.manage', () => {
    held.permissions = ['workflow.manage', 'settings.manage']
    const { container } = renderCard()
    expect(container.innerHTML).toBe('')
    expect(fetchRouting).not.toHaveBeenCalled()
  })
})
