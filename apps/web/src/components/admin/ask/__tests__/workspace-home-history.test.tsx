// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceCopilotProvider } from '../workspace-copilot'
import {
  AskQuackbackInline,
  AskPaletteTrigger,
  WorkspaceCopilotFocused,
  useWorkspaceCopilotEnabled,
  useWorkspaceCopilotFocused,
} from '../workspace-copilot-context'
import type { AskComposerProps } from '../ask-composer'
import type { ChatComposerProps } from '../chat-composer'
import type { WorkspaceCopilotThread } from '@/lib/shared/assistant/workspace-contract'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  pathname: '/admin',
  enabled: true,
  permissions: new Set(['copilot.use']),
  threads: [] as WorkspaceCopilotThread[],
  navigate: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  layoutRendered: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: state.navigate }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: state.pathname, searchStr: '' } }),
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
  createWorkspaceCopilotThreadFn: (input: unknown) => state.create(input),
}))
vi.mock('@/lib/server/functions/ask-search', () => ({
  searchAskEntitiesFn: async ({ data }: { data: { query: string } }) => {
    expect(data.query.length).toBeGreaterThanOrEqual(2)
    return state.search(data.query)
  },
}))
vi.mock('../use-workspace-transport', () => ({
  useWorkspaceTransport: () => ({
    start: (options: unknown) => state.start(options),
    stop: state.stop,
    clear: state.clear,
    renderer: null,
  }),
}))
vi.mock('../ask-composer', () => ({
  AskComposer: ({ query, onQueryChange, results, onNavigate }: AskComposerProps) => (
    <div data-testid="search-palette">
      <input
        role="combobox"
        aria-label="Search Quackback"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0]) onNavigate(results[0].href)
        }}
      />
      {results.map((item) => (
        <button role="option" key={item.id} onClick={() => onNavigate(item.href)}>
          {item.title}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('../chat-composer', () => ({
  ChatComposer: ({
    canAsk,
    busy,
    query,
    onQueryChange,
    onAsk,
    onStop,
    footerActions,
    autoFocus = true,
  }: ChatComposerProps) => (
    <div data-testid="chat-composer">
      <textarea
        autoFocus={autoFocus}
        aria-label="Ask Copilot"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <button disabled={!canAsk || busy} onClick={() => onAsk(query)}>
        Ask
      </button>
      {busy && <button onClick={onStop}>Stop</button>}
      <div data-testid="composer-footer">{footerActions}</div>
    </div>
  ),
}))
vi.mock('@/components/shared/conversation/message-markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
}))

function Home() {
  const enabled = useWorkspaceCopilotEnabled()
  const focused = useWorkspaceCopilotFocused()
  state.layoutRendered(enabled, focused)
  return (
    <>
      <output aria-label="Inline Copilot">{enabled ? 'enabled' : 'disabled'}</output>
      <output aria-label="Focused Copilot">{focused ? 'focused' : 'home'}</output>
      {!focused && <AskPaletteTrigger />}
      {focused ? <WorkspaceCopilotFocused /> : <AskQuackbackInline />}
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
  state.pathname = '/admin'
  state.enabled = true
  state.permissions = new Set(['copilot.use'])
  state.threads = []
  state.search.mockImplementation((query: string) => {
    expect(query.trim().length).toBeGreaterThanOrEqual(2)
    return []
  })
  state.create.mockImplementation(({ data }: { data: { title: string } }) => {
    throw new Error(`Unexpected creation: ${data.title}`)
  })
  state.start.mockImplementation(({ question }: { question: string }) => {
    throw new Error(`Unexpected question: ${question}`)
  })
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
  expect(screen.getByLabelText('Focused Copilot')).toHaveTextContent('focused')
  expect(screen.getByTestId('chat-composer')).toBeTruthy()
  fireEvent.click(reset)
  expect(screen.queryByRole('region', { name: 'Copilot' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Your conversations' })).toBeTruthy()
})

it('uses the server availability result for the inline Home layout', async () => {
  state.enabled = false
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Search Quackback' }))
  await screen.findByRole('combobox', { name: 'Search Quackback' })
  expect(screen.queryByRole('textbox', { name: 'Ask Copilot' })).toBeNull()
  expect(screen.getByLabelText('Inline Copilot')).toHaveTextContent('disabled')
})

it('keeps the palette layout when the teammate lacks Copilot permission', async () => {
  state.permissions = new Set()
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Search Quackback' }))
  await screen.findByRole('combobox', { name: 'Search Quackback' })
  expect(screen.queryByRole('textbox', { name: 'Ask Copilot' })).toBeNull()
  expect(screen.getByLabelText('Inline Copilot')).toHaveTextContent('disabled')
})

it('keeps the Home layout unsubscribed from composer keystrokes', async () => {
  mount()
  const input = await screen.findByRole('textbox', { name: 'Ask Copilot' })
  expect(state.layoutRendered).toHaveBeenLastCalledWith(true, false)
  const renders = state.layoutRendered.mock.calls.length
  fireEvent.change(input, { target: { value: 'messenger' } })
  expect(input).toHaveValue('messenger')
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
  expect(state.layoutRendered).toHaveBeenCalledTimes(renders)
  expect(state.search).not.toHaveBeenCalled()
})

it('returns Home without losing the selected conversation or unsent text', async () => {
  state.threads = [
    {
      key: 'workspace:acme-policy',
      title: 'Refund policy',
      updatedAt: '2026-10-03T00:00:00.000Z',
      messages: [
        {
          id: 'policy-question',
          sender: 'customer',
          text: 'Find our refund policy',
          createdAt: '2026-10-03T00:00:00.000Z',
        },
      ],
    },
  ]
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Your conversations' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Refund policy' }))
  expect(await screen.findByText('Find our refund policy')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this follow-up' } })
  const clears = state.clear.mock.calls.length
  const stops = state.stop.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  expect(screen.getByLabelText('Focused Copilot')).toHaveTextContent('home')
  expect(screen.queryByText('Find our refund policy')).toBeNull()
  expect(screen.getByRole('textbox')).toHaveValue('Keep this follow-up')
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
  expect(state.clear).toHaveBeenCalledTimes(clears)
  expect(state.stop).toHaveBeenCalledTimes(stops)
  fireEvent.click(screen.getByRole('button', { name: 'Your conversations' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Refund policy' }))
  expect(await screen.findByText('Find our refund policy')).toBeTruthy()
  expect(screen.getByRole('textbox')).toHaveValue('Keep this follow-up')
})

it('focuses a new chat before its first thread finishes creating and preserves its stream on Back', async () => {
  let finish!: (value: { key: string }) => void
  const creating = new Promise<{ key: string }>((resolve) => {
    finish = resolve
  })
  state.create.mockImplementation((input: unknown) => {
    expect(input).toEqual({ data: { title: 'Find our help articles' } })
    return creating
  })
  state.start.mockImplementation(
    async (options: { question: string; forwardedProps: { threadKey: string } }) => {
      expect(options.question).toBe('Find our help articles')
      expect(options.forwardedProps).toEqual({ threadKey: 'workspace:acme-help' })
    }
  )
  mount()
  await screen.findByRole('textbox', { name: 'Ask Copilot' })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Find our help articles' } })
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
  expect(screen.getByLabelText('Focused Copilot')).toHaveTextContent('focused')
  expect(screen.getByText('Find our help articles')).toBeTruthy()
  const stops = state.stop.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  expect(screen.getByLabelText('Focused Copilot')).toHaveTextContent('home')
  expect(state.stop).toHaveBeenCalledTimes(stops)
  await act(async () => finish({ key: 'workspace:acme-help' }))
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce())
})

it('keeps layout consumers stable while typing into a focused chat', async () => {
  state.threads = [
    {
      key: 'workspace:acme-stable',
      title: 'Stable layout',
      updatedAt: '2026-10-03T00:00:00.000Z',
      messages: [],
    },
  ]
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Your conversations' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stable layout' }))
  const input = await screen.findByRole('textbox', { name: 'Ask Copilot' })
  expect(state.layoutRendered).toHaveBeenLastCalledWith(true, true)
  const renders = state.layoutRendered.mock.calls.length
  fireEvent.change(input, { target: { value: 'A follow-up' } })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
  expect(state.layoutRendered).toHaveBeenCalledTimes(renders)
  expect(state.search).not.toHaveBeenCalled()
})

it('keeps search independent from an unsent Home message and never starts Copilot with Ctrl+K Enter', async () => {
  mount()
  const chatInput = await screen.findByRole('textbox', { name: 'Ask Copilot' })
  fireEvent.change(chatInput, { target: { value: 'Draft a help center article' } })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
  expect(state.search).not.toHaveBeenCalled()
  expect(screen.queryByTestId('search-palette')).toBeNull()
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const searchInput = await screen.findByRole('combobox', { name: 'Search Quackback' })
  expect(searchInput).toHaveValue('')
  fireEvent.change(searchInput, { target: { value: 'refund policies' } })
  await vi.waitFor(() => expect(state.search).toHaveBeenCalledExactlyOnceWith('refund policies'))
  fireEvent.keyDown(searchInput, { key: 'Enter' })
  expect(state.create).not.toHaveBeenCalled()
  expect(state.start).not.toHaveBeenCalled()
  expect(chatInput).toHaveValue('Draft a help center article')
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toHaveValue(
    'Draft a help center article'
  )
})

it('leaves Ctrl+K to a handler that already took it, and to the Inbox command bar', async () => {
  mount()
  await screen.findByRole('textbox', { name: 'Ask Copilot' })
  const taken = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
  taken.preventDefault()
  act(() => {
    window.dispatchEvent(taken)
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(screen.queryByTestId('search-palette')).toBeNull()
  cleanup()
  state.pathname = '/admin/inbox'
  mount()
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(screen.queryByTestId('search-palette')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Search Quackback' }))
  expect(await screen.findByTestId('search-palette')).toBeTruthy()
})
