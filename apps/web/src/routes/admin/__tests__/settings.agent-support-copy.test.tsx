// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const hoisted = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  canManage: true,
  updateFlags: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: hoisted.invalidate }),
  useBlocker: () => ({ status: 'idle', reset: vi.fn(), proceed: vi.fn() }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ isPending: false, isError: false }),
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess?: () => void }) => ({
    mutateAsync: vi.fn(),
    mutate: () => void options.mutationFn().then(() => options.onSuccess?.()),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  queryOptions: (options: unknown) => options,
}))
vi.mock('@/lib/server/functions/feature-flags', () => ({
  updateFeatureFlagsFn: hoisted.updateFlags,
}))
vi.mock('@/lib/client/use-permissions', () => ({
  useHasPermission: () => hoisted.canManage,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({
    featureFlags: hoisted.flags,
    publicWidgetConfig: { messenger: { assistant: { enabled: true, respond: true } } },
  }),
}))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: ({
    description,
    actions,
    children,
  }: {
    description?: string
    actions?: ReactNode
    children?: ReactNode
  }) => (
    <div>
      <p data-testid="description">{description}</p>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
}))
vi.mock('@/components/admin/automation/additional-instructions-card', () => ({
  AdditionalInstructionsCard: () => null,
}))
vi.mock('@/components/admin/automation/assistant-identity-card', () => ({
  AssistantIdentityCard: () => null,
}))
vi.mock('@/components/admin/automation/assistant-basics-card', () => ({
  AssistantVoiceCard: () => null,
}))
vi.mock('@/components/admin/automation/assistant-knowledge-card', () => ({
  AgentKnowledgeCard: () => null,
}))
vi.mock('@/components/admin/automation/guidance-rules-card', () => ({
  GuidanceRulesCard: () => null,
}))
vi.mock('@/components/admin/automation/assistant-form', () => ({
  AssistantDirtyStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAssistantDirtyState: () => ({ dirtyTabs: new Set(), hasUnsavedChanges: false }),
}))
vi.mock('@/lib/client/mutations/assistant', () => ({
  useUpdateWidgetAssistantDeployment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const { Route } = await import('../settings.agent')
const AgentPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component

function renderPage(flags: Record<string, boolean>, canManage = true) {
  hoisted.flags = flags
  hoisted.canManage = canManage
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <AgentPage />
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('Agent page without the Support inbox', () => {
  it('asks to turn on Support when neither the inbox nor tickets is on', () => {
    renderPage({ supportInbox: false, supportTickets: false })
    expect(screen.getByTestId('description')).toHaveTextContent(/Turn on Support/)
    expect(screen.getByRole('link', { name: 'Open product settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause Agent' })).toBeNull()
  })

  it('tells a tickets-only workspace that Messenger replies need the Support inbox', () => {
    renderPage({ supportInbox: false, supportTickets: true })
    expect(screen.getByTestId('description')).toHaveTextContent(/need the Support inbox/)
    expect(screen.getByTestId('description')).not.toHaveTextContent('Replying in Messenger')
    expect(screen.queryByRole('button', { name: 'Pause Agent' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Turn on inbox' })).toBeInTheDocument()
  })

  it('lets a tickets-only admin turn the inbox on from the page', async () => {
    hoisted.updateFlags.mockResolvedValue({})
    renderPage({ supportInbox: false, supportTickets: true })
    expect(screen.queryByRole('link', { name: 'Open product settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on inbox' }))
    expect(hoisted.updateFlags).toHaveBeenCalledWith({ data: { supportInbox: true } })
    await waitFor(() => expect(hoisted.invalidate).toHaveBeenCalled())
  })

  it('shows a tickets-only viewer without settings.manage no action', () => {
    renderPage({ supportInbox: false, supportTickets: true }, false)
    expect(screen.queryByRole('button', { name: 'Turn on inbox' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open product settings' })).toBeNull()
    expect(screen.getByTestId('description')).toHaveTextContent(
      'Messenger replies need the Support inbox.'
    )
  })

  it('shows the live line and the pause control once the inbox is on', () => {
    renderPage({ supportInbox: true, supportTickets: false })
    expect(screen.getByTestId('description')).toHaveTextContent('Replying in Messenger')
    expect(screen.getByRole('button', { name: 'Pause Agent' })).toBeInTheDocument()
  })

  it('offers the General link only to someone who can open General', () => {
    renderPage({ supportInbox: false, supportTickets: false }, false)
    expect(screen.queryByRole('link', { name: 'Open product settings' })).toBeNull()
    expect(screen.getByTestId('description')).toHaveTextContent(/Turn on Support/)
  })
})
