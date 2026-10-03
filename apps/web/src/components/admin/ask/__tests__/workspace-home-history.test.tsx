// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceCopilotProvider } from '../workspace-copilot'
import { AskQuackbackInline, useWorkspaceCopilotEnabled } from '../workspace-copilot-context'
import type { AskComposerProps } from '../ask-composer'
import type { WorkspaceCopilotThread } from '@/lib/shared/assistant/workspace-contract'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  enabled: true,
  permissions: new Set(['copilot.use']),
  threads: [] as WorkspaceCopilotThread[],
  navigate: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  layoutRendered: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: state.navigate }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: '/admin', searchStr: '' } }),
}))
vi.mock('@/lib/client/use-permissions', () => ({ usePermissions: () => state.permissions }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  usePrincipalId: () => 'owner-acme',
  useFeatureFlags: () => ({ feedback: true }),
  useBillingEnabled: () => false,
  useCloudEnabled: () => false,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({ queryKey: ['onboarding-status'], queryFn: async () => null }),
  },
}))
vi.mock('@/lib/server/functions/workspace-copilot', () => ({
  getWorkspaceCopilotAvailabilityFn: async () => ({ enabled: state.enabled }),
  listWorkspaceCopilotThreadsFn: async () =>
    state.threads.map(({ key, title, updatedAt }) => ({ key, title, updatedAt })),
  getWorkspaceCopilotThreadFn: async ({ data }: { data: { threadKey: string } }) => {
    const thread = state.threads.find((item) => item.key === data.threadKey)
    if (!thread) throw new Error('Unknown thread')
    return thread
  },
  createWorkspaceCopilotThreadFn: async ({ data }: { data: { title: string } }) => {
    throw new Error(`Unexpected creation: ${data.title}`)
  },
}))
vi.mock('@/lib/server/functions/ask-search', () => ({
  searchAskEntitiesFn: async ({ data }: { data: { query: string } }) => {
    expect(data.query.length).toBeGreaterThanOrEqual(2)
    return []
  },
}))
vi.mock('../use-workspace-transport', () => ({
  useWorkspaceTransport: () => ({
    start: async ({ question }: { question: string }) => {
      throw new Error(`Unexpected question: ${question}`)
    },
    stop: state.stop,
    clear: state.clear,
    renderer: null,
  }),
}))
vi.mock('../ask-composer', () => ({
  AskComposer: ({ canAsk, footerActions, query, onQueryChange }: AskComposerProps) => (
    <div data-testid="composer">
      <input
        aria-label={canAsk ? 'Ask Copilot' : 'Search Quackback'}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div data-testid="composer-footer">{footerActions}</div>
    </div>
  ),
}))
vi.mock('@/components/shared/conversation/message-markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
}))

function Home() {
  const enabled = useWorkspaceCopilotEnabled()
  state.layoutRendered(enabled)
  return (
    <>
      <output aria-label="Inline Copilot">{enabled ? 'enabled' : 'disabled'}</output>
      <AskQuackbackInline />
    </>
  )
}
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <WorkspaceCopilotProvider>
          <Home />
        </WorkspaceCopilotProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.enabled = true
  state.permissions = new Set(['copilot.use'])
  state.threads = []
})
afterEach(cleanup)

it('keeps a fresh Home free of empty conversation controls', async () => {
  mount()
  await screen.findByRole('textbox', { name: 'Ask Copilot' })
  expect(screen.queryByRole('button', { name: 'Your conversations' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Copilot' })).toBeNull()
  expect(screen.getByLabelText('Inline Copilot')).toHaveTextContent('enabled')
})

it('keeps saved history in the composer without an empty transcript section', async () => {
  state.threads = [
    {
      key: 'workspace:acme-brand',
      title: 'Update my brand',
      updatedAt: '2026-10-03T00:00:00.000Z',
      messages: [
        {
          id: 'message-one',
          sender: 'customer',
          text: 'Use a green brand',
          createdAt: '2026-10-03T00:00:00.000Z',
        },
      ],
    },
    {
      key: 'workspace:acme-messenger',
      title: 'Enable Messenger',
      updatedAt: '2026-10-02T00:00:00.000Z',
      messages: [
        {
          id: 'message-two',
          sender: 'customer',
          text: 'Turn on Messenger',
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    },
  ]
  mount()
  const history = await screen.findByRole('button', { name: 'Your conversations' })
  expect(
    within(screen.getByTestId('composer-footer')).getByRole('button', {
      name: 'Your conversations',
    })
  ).toBe(history)
  expect(screen.queryByRole('region', { name: 'Copilot' })).toBeNull()
  fireEvent.click(history)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Enable Messenger' }))
  expect(await screen.findByText('Turn on Messenger')).toBeTruthy()
  expect(screen.queryByText('Use a green brand')).toBeNull()
  const reset = screen.getByRole('button', { name: 'New conversation' })
  expect(
    within(screen.getByTestId('composer-footer')).getByRole('button', { name: 'New conversation' })
  ).toBe(reset)
  fireEvent.click(reset)
  expect(screen.queryByRole('region', { name: 'Copilot' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Your conversations' })).toBeTruthy()
})

it('uses the server availability result for the inline Home layout', async () => {
  state.enabled = false
  mount()
  await screen.findByRole('textbox', { name: 'Search Quackback' })
  expect(screen.getByLabelText('Inline Copilot')).toHaveTextContent('disabled')
})

it('keeps the palette layout when the teammate lacks Copilot permission', async () => {
  state.permissions = new Set()
  mount()
  await screen.findByRole('textbox', { name: 'Search Quackback' })
  expect(screen.getByLabelText('Inline Copilot')).toHaveTextContent('disabled')
})

it('keeps the Home layout unsubscribed from composer keystrokes', async () => {
  mount()
  const input = await screen.findByRole('textbox', { name: 'Ask Copilot' })
  expect(state.layoutRendered).toHaveBeenLastCalledWith(true)
  const renders = state.layoutRendered.mock.calls.length
  fireEvent.change(input, { target: { value: 'messenger' } })
  expect(input).toHaveValue('messenger')
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
  expect(state.layoutRendered).toHaveBeenCalledTimes(renders)
})
