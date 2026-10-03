// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceCopilotProvider } from '../workspace-copilot'
import { AskQuackbackInline } from '../workspace-copilot-context'
import type { AskComposerProps } from '../ask-composer'
import type { StartAguiTurnOptions } from '@/lib/client/hooks/use-agui-turn'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  principalId: 'owner-acme' as string | undefined,
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: state.navigate }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: '/admin', searchStr: '' } }),
}))
vi.mock('@/lib/client/use-permissions', () => ({
  usePermissions: () => new Set(['copilot.use']),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  usePrincipalId: () => state.principalId,
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
  createWorkspaceCopilotThreadFn: (input: unknown) => state.create(input),
  getWorkspaceCopilotAvailabilityFn: async () => ({ enabled: true }),
  listWorkspaceCopilotThreadsFn: async () => [],
  getWorkspaceCopilotThreadFn: async ({ data }: { data: { threadKey: string } }) => ({
    key: data.threadKey,
    title: 'Acme',
    messages: [],
  }),
}))
vi.mock('@/lib/server/functions/ask-search', () => ({
  searchAskEntitiesFn: async ({ data }: { data: { query: string } }) => {
    expect(data.query.length).toBeGreaterThanOrEqual(2)
    return []
  },
}))
vi.mock('@/lib/client/hooks/use-agui-turn', () => ({
  useAguiTurn: (options: unknown) => {
    expect(options).toEqual({ url: '/api/admin/assistant/workspace' })
    return { start: state.start, stop: state.stop, clear: state.clear }
  },
}))
vi.mock('../ask-composer', () => ({
  AskComposer: ({ query, onQueryChange, canAsk, onAsk, footerActions }: AskComposerProps) => (
    <>
      <input aria-label="Question" value={query} onChange={(e) => onQueryChange(e.target.value)} />
      <button disabled={!canAsk} onClick={() => onAsk(query)}>
        Ask
      </button>
      {footerActions}
    </>
  ),
}))
vi.mock('@/components/shared/conversation/message-markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
}))

const question = 'Turn on Messenger'
const threadKey = 'workspace:acme'
function deferredThread() {
  let resolve!: (value: { key: string }) => void
  const promise = new Promise<{ key: string }>((ready) => {
    resolve = ready
  })
  return { promise, resolve }
}
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <WorkspaceCopilotProvider>
          <AskQuackbackInline />
        </WorkspaceCopilotProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
  const rendered = render(tree())
  return { ...rendered, rerenderCurrent: () => rendered.rerender(tree()) }
}

beforeEach(() => {
  vi.resetAllMocks()
  state.principalId = 'owner-acme'
  state.start.mockImplementation(async (options: StartAguiTurnOptions) => {
    expect(options.question).toBe(question)
    expect(options.forwardedProps).toEqual({ threadKey })
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
async function ask() {
  await vi.waitFor(() =>
    expect((screen.getByRole('button', { name: /^Ask$/ }) as HTMLButtonElement).disabled).toBe(
      false
    )
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith({ data: { title: question } }))
}

it('does not submit a first question stopped while thread creation is pending', async () => {
  const creating = deferredThread()
  state.create.mockImplementation((input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return creating.promise
  })
  mount()
  await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await act(async () => {
    creating.resolve({ key: threadKey })
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  expect(state.start).not.toHaveBeenCalled()
})

it('releases the composer immediately when a pending first question is stopped', async () => {
  const creating = deferredThread()
  state.create.mockImplementation((input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return creating.promise
  })
  mount()
  await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect((screen.getByRole('button', { name: /^Ask$/ }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => creating.resolve({ key: threadKey }))
  expect(state.start).not.toHaveBeenCalled()
})

it('does not submit or restore a question after its principal signs out during creation', async () => {
  const creating = deferredThread()
  state.create.mockImplementation((input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return creating.promise
  })
  const mounted = mount()
  await ask()
  state.principalId = undefined
  mounted.rerenderCurrent()
  await act(async () => {
    creating.resolve({ key: threadKey })
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  expect(state.start).not.toHaveBeenCalled()
  expect((screen.getByRole('textbox', { name: 'Question' }) as HTMLInputElement).value).toBe('')
  expect(screen.queryByText(question)).toBeNull()
})

it('continues to submit a first question that was not cancelled', async () => {
  state.create.mockImplementation(async (input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return { key: threadKey }
  })
  mount()
  await ask()
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1))
})

it('does not resume thread initialization after the provider unmounts', async () => {
  const creating = deferredThread()
  state.create.mockImplementationOnce(async (input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return { key: threadKey }
  })
  const mounted = mount()
  await ask()
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1))
  state.create.mockImplementationOnce((input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return creating.promise
  })
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  await ask()
  expect(state.create).toHaveBeenCalledTimes(2)
  mounted.unmount()
  const clearsAfterUnmount = state.clear.mock.calls.length
  await act(async () => creating.resolve({ key: threadKey }))
  expect(state.clear).toHaveBeenCalledTimes(clearsAfterUnmount)
  expect(state.start).toHaveBeenCalledTimes(1)
})

it("does not let a cancelled creation clear a replacement question's busy state", async () => {
  const creating = deferredThread()
  const nextQuestion = 'Set my brand color to #0F766E'
  const nextKey = 'workspace:acme-retry'
  let finishStream!: () => void
  const stream = new Promise<void>((resolve) => {
    finishStream = resolve
  })
  state.create
    .mockImplementationOnce((input: unknown) => {
      expect(input).toEqual({ data: { title: question } })
      return creating.promise
    })
    .mockImplementationOnce(async (input: unknown) => {
      expect(input).toEqual({ data: { title: nextQuestion } })
      return { key: nextKey }
    })
  state.start.mockImplementation((options: StartAguiTurnOptions) => {
    expect(options.question).toBe(nextQuestion)
    expect(options.forwardedProps).toEqual({ threadKey: nextKey })
    return stream
  })
  mount()
  await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: nextQuestion },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1))
  await act(async () => creating.resolve({ key: threadKey }))
  expect((screen.getByRole('button', { name: /^Ask$/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  await act(async () => finishStream())
  expect((screen.getByRole('button', { name: /^Ask$/ }) as HTMLButtonElement).disabled).toBe(false)
})

it('ignores late stream updates, final answers, and errors from a stopped request', async () => {
  let handlers!: StartAguiTurnOptions['handlers']
  let finishStream!: () => void
  const stream = new Promise<void>((resolve) => {
    finishStream = resolve
  })
  state.create.mockImplementation(async (input: unknown) => {
    expect(input).toEqual({ data: { title: question } })
    return { key: threadKey }
  })
  state.start.mockImplementation((options: StartAguiTurnOptions) => {
    expect(options.question).toBe(question)
    expect(options.forwardedProps).toEqual({ threadKey })
    handlers = options.handlers
    return stream
  })
  mount()
  await ask()
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await act(async () => {
    handlers.onTextDelta?.('Late stream text', 'Late stream text')
    handlers.onFinal({
      threadKey,
      messageId: 'late-answer',
      text: 'Late final answer',
      citations: [],
      proposedActions: [],
      navigation: [],
    })
    handlers.onError('Late error')
    finishStream()
  })
  expect(screen.queryByText('Late stream text')).toBeNull()
  expect(screen.queryByText('Late final answer')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('textbox', { name: 'Question' }) as HTMLInputElement).value).toBe('')
})
