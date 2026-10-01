// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const hoisted = vi.hoisted(() => ({ flags: {} as Record<string, boolean> }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  redirect: vi.fn(),
  useBlocker: () => ({ status: 'idle', reset: vi.fn(), proceed: vi.fn() }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ isPending: false, isError: false }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({}),
  queryOptions: (options: unknown) => options,
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

function renderPage(flags: Record<string, boolean>) {
  hoisted.flags = flags
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <AgentPage />
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('Agent page without the Support product', () => {
  it('asks to turn on Support when neither the inbox nor tickets is on', () => {
    renderPage({ supportInbox: false, supportTickets: false })
    expect(screen.getByTestId('description')).toHaveTextContent(/Turn on Support/)
    expect(screen.getByRole('link', { name: 'Open product settings' })).toBeInTheDocument()
  })

  it('does not ask a tickets-only workspace to turn on Support', () => {
    renderPage({ supportInbox: false, supportTickets: true })
    expect(screen.getByTestId('description')).not.toHaveTextContent(/Turn on Support/)
    expect(screen.getByRole('button', { name: 'Pause Agent' })).toBeInTheDocument()
  })

  it('treats the inbox alone as the Support product', () => {
    renderPage({ supportInbox: true, supportTickets: false })
    expect(screen.getByTestId('description')).toHaveTextContent('Replying in Messenger')
  })
})
