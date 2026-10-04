// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatComposerProps } from '../chat-composer'
import type { StartAguiTurnOptions } from '@/lib/client/hooks/use-agui-turn'
import type { WorkspaceCopilotThread } from '@/lib/shared/assistant/workspace-contract'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  threads: [] as WorkspaceCopilotThread[],
  navigations: [] as unknown[],
  backs: 0,
  setThread: (_key: string | undefined) => {},
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  decisions: [] as Array<[string, string]>,
  actionStatus: 'proposed',
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: (options: { to?: string; href?: string; search?: { copilotThread?: string } }) => {
      state.navigations.push(options)
      if (options.to === '/admin') state.setThread(options.search?.copilotThread)
    },
    history: {
      back: () => {
        state.backs++
        state.setThread(undefined)
      },
    },
  }),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ usePrincipalId: () => 'owner-acme' }))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({ queryKey: ['onboarding-status'], queryFn: async () => null }),
  },
}))
vi.mock('@/lib/server/functions/workspace-copilot', () => ({
  createWorkspaceCopilotThreadFn: (input: unknown) => state.create(input),
  listWorkspaceCopilotThreadsFn: async () =>
    state.threads.map(({ key, title, updatedAt }) => ({ key, title, updatedAt })),
  getWorkspaceCopilotThreadFn: async ({ data }: { data: { threadKey: string } }) => {
    const thread = state.threads.find((item) => item.key === data.threadKey)
    if (!thread) throw new Error('Unknown thread')
    return thread
  },
}))
vi.mock('@/lib/server/functions/assistant-actions', () => ({
  approveAssistantActionFn: async ({ data }: { data: { pendingActionId: string } }) => {
    state.decisions.push([data.pendingActionId, 'approved'])
    return { id: data.pendingActionId, status: 'executed' }
  },
  rejectAssistantActionFn: async ({ data }: { data: { pendingActionId: string } }) => {
    state.decisions.push([data.pendingActionId, 'rejected'])
    return { id: data.pendingActionId, status: 'rejected' }
  },
}))
vi.mock('@/lib/client/queries/assistant-pending-actions', () => ({
  assistantPendingActionQueries: {
    detail: (id: string) => ({
      queryKey: ['pending-action', id],
      queryFn: async () => ({ id, status: state.actionStatus }),
    }),
  },
}))
vi.mock('../workspace-settings-proposal-card', () => ({
  WorkspaceSettingsProposalCard: () => <p>Settings card</p>,
}))
vi.mock('../search-palette', () => ({
  useSearchPalette: () => ({ open: vi.fn() }),
  useSearchShortcutLabel: () => 'Ctrl K',
}))
vi.mock('@/lib/client/hooks/use-agui-turn', () => ({
  useAguiTurn: (options: unknown) => {
    expect(options).toEqual({ url: '/api/admin/assistant/workspace' })
    return { start: state.start, stop: state.stop, clear: state.clear }
  },
}))
vi.mock('../chat-composer', () => ({
  ChatComposer: ({ query, onQueryChange, canAsk, busy, onAsk, onStop }: ChatComposerProps) => (
    <div>
      <textarea
        aria-label="Ask Copilot"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <button disabled={!canAsk || busy} onClick={() => onAsk(query)}>
        Send
      </button>
      {busy && <button onClick={onStop}>Stop</button>}
    </div>
  ),
}))
vi.mock('@/components/shared/conversation/message-markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
}))

import { CopilotHome } from '../copilot-home'

function Harness({
  initial,
  canAsk,
  locked,
}: {
  initial?: string
  canAsk: boolean
  locked?: boolean
}) {
  const [threadKey, setThreadKey] = useState(initial)
  state.setThread = setThreadKey
  return (
    <CopilotHome
      threadKey={threadKey}
      canAsk={canAsk}
      header={<h1>Welcome, Acme</h1>}
      chips={<a href="/admin?open=invite-team">Invite your team</a>}
      locked={locked ? <a href="/admin/settings/billing">Upgrade</a> : undefined}
      below={<p>Launch plan</p>}
    />
  )
}
function mount({
  thread,
  canAsk = true,
  locked = false,
}: { thread?: string; canAsk?: boolean; locked?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <Harness initial={thread} canAsk={canAsk} locked={locked} />
      </IntlProvider>
    </QueryClientProvider>
  )
}
const savedThread = (key: string, title: string, text: string): WorkspaceCopilotThread => ({
  key,
  title,
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  messages: [{ id: `${key}-1`, sender: 'customer', text, createdAt: '2026-10-03T00:00:00.000Z' }],
})

beforeEach(() => {
  vi.clearAllMocks()
  state.threads = []
  state.navigations = []
  state.backs = 0
  state.decisions = []
  state.actionStatus = 'proposed'
  state.create.mockImplementation(({ data }: { data: { title: string } }) => {
    throw new Error(`Unexpected creation: ${data.title}`)
  })
  state.start.mockImplementation(({ question }: StartAguiTurnOptions) => {
    throw new Error(`Unexpected question: ${question}`)
  })
})
afterEach(cleanup)

describe('Home idle', () => {
  it('offers Continue for the latest chat but starts a new one from the composer', async () => {
    state.threads = [savedThread('workspace:brand', 'Brand color and Messenger', 'Use green')]
    state.create.mockResolvedValue({ key: 'workspace:new' })
    state.start.mockImplementation(async (options: StartAguiTurnOptions) => {
      expect(options.question).toBe('Invite my team')
      expect(options.forwardedProps).toEqual({ threadKey: 'workspace:new' })
    })
    mount()
    expect(await screen.findByText('Continue: Brand color and Messenger')).toBeTruthy()
    expect(screen.getByText('· 2 hours ago')).toBeTruthy()
    expect(screen.getByText('Launch plan')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Copilot' }), {
      target: { value: 'Invite my team' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    expect(state.create).toHaveBeenCalledWith({ data: { title: 'Invite my team' } })
    expect(state.navigations).toEqual([
      { to: '/admin', search: { copilotThread: 'workspace:new' } },
    ])
  })

  it('opens the Continue row inline: the overview folds away and the same composer stays', async () => {
    state.threads = [savedThread('workspace:brand', 'Brand color', 'Use a green brand')]
    mount()
    const composer = screen.getByRole('textbox', { name: 'Ask Copilot' })
    fireEvent.click(await screen.findByText('Continue: Brand color'))
    expect(await screen.findByText('Use a green brand')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(overview('Launch plan')).toEqual({ state: 'closed', inert: true })
    expect(overview('Welcome, Acme')).toEqual({ state: 'closed', inert: true })
    expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toBe(composer)
    await waitFor(() => expect(document.activeElement).toBe(composer))
  })

  it('shows the chips it is given, which never start a Copilot turn', async () => {
    mount()
    expect(screen.getByRole('link', { name: 'Invite your team' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set up my feedback board' })).toBeNull()
  })

  it('opens at the top of Home, with the composer in view', async () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    const view = mount()
    await screen.findByText('Launch plan')
    const viewport = view.container.querySelector('[data-slot="copilot-viewport"]') as HTMLElement
    expect(viewport.scrollTop).toBe(0)
    scrollHeight.mockRestore()
  })

  it('greys out the composer without credits and offers the way to get them', async () => {
    mount({ canAsk: false, locked: true })
    const composer = screen.getByRole('textbox', { name: 'Ask Copilot', hidden: true })
    expect(composer.closest('[inert]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Ask Copilot' }))
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
  })
})

function overview(text: string) {
  const region = screen.getByText(text).closest('[data-state]')
  return { state: region?.getAttribute('data-state'), inert: region?.hasAttribute('inert') }
}

async function openContinue() {
  state.threads = [savedThread('workspace:brand', 'Brand color', 'Use a green brand')]
  mount()
  fireEvent.click(await screen.findByText('Continue: Brand color'))
  await screen.findByText('Use a green brand')
}

describe('leaving the inline chat', () => {
  it('returns to the overview from the Back control and focuses the composer', async () => {
    await openContinue()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(state.backs).toBe(1))
    expect(overview('Launch plan')).toEqual({ state: 'open', inert: false })
    expect(screen.queryByText('Use a green brand')).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask Copilot' }))
    )
  })

  it('returns to the overview when the browser goes back', async () => {
    await openContinue()
    act(() => state.setThread(undefined))
    expect(overview('Launch plan')).toEqual({ state: 'open', inert: false })
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('keeps a streaming turn running when the person leaves', async () => {
    let handlers!: StartAguiTurnOptions['handlers']
    state.start.mockImplementation(
      (options: StartAguiTurnOptions) =>
        new Promise<void>(() => {
          handlers = options.handlers
        })
    )
    await openContinue()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Copilot' }), {
      target: { value: 'And the logo?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(state.backs).toBe(1))
    expect(state.stop).not.toHaveBeenCalled()
    expect(handlers).toBeDefined()
  })

  it('swaps instantly under reduced motion', async () => {
    await openContinue()
    const regions = document.querySelectorAll('[data-home-copilot] [class*="transition-"]')
    const moving = [...regions].filter((element) =>
      /transition-\[[^\]]*(grid-template-rows|flex-grow)/.test(element.className)
    )
    expect(moving.length).toBe(3)
    for (const element of moving)
      expect(element.className).toContain('motion-reduce:transition-none')
  })
})

describe('inline chat', () => {
  it('returns Home on Esc, through history when it came from Home', async () => {
    state.threads = [savedThread('workspace:brand', 'Brand color', 'Use a green brand')]
    mount()
    fireEvent.click(await screen.findByText('Continue: Brand color'))
    await screen.findByText('Use a green brand')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(state.backs).toBe(1))
    expect(await screen.findByText('Continue: Brand color')).toBeTruthy()
  })

  it('returns a review link to Home without leaving the app, and leaves Esc to open overlays', async () => {
    state.threads = [savedThread('workspace:review', 'Review', 'Proposed by an integration')]
    mount({ thread: 'workspace:review' })
    await screen.findByText('Proposed by an integration')
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    document.body.appendChild(overlay)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(state.navigations).toEqual([])
    overlay.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(state.navigations).toEqual([{ to: '/admin', search: {} }]))
    expect(state.backs).toBe(0)
  })

  it('lets a teammate review a thread without a composer when new chats are unavailable', async () => {
    state.threads = [savedThread('workspace:review', 'Review', 'Proposed by an integration')]
    mount({ thread: 'workspace:review', canAsk: false })
    expect(await screen.findByText('Proposed by an integration')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Ask Copilot' })).toBeNull()
  })

  it('follows the latest message once the transcript renders', async () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.querySelector('section') ? 900 : 0
      })
    state.threads = [savedThread('workspace:long', 'Long', 'A long conversation')]
    const view = mount({ thread: 'workspace:long' })
    await screen.findByText('A long conversation')
    const viewport = view.container.querySelector('[data-slot="copilot-viewport"]') as HTMLElement
    await waitFor(() => expect(viewport.scrollTop).toBe(900))
    scrollHeight.mockRestore()
  })

  it('stops the stream when Home unmounts, and ignores what arrives after Stop', async () => {
    state.threads = [savedThread('workspace:brand', 'Brand', 'Use green')]
    let handlers!: StartAguiTurnOptions['handlers']
    state.start.mockImplementation(
      (options: StartAguiTurnOptions) =>
        new Promise<void>(() => {
          handlers = options.handlers
        })
    )
    const view = mount({ thread: 'workspace:brand' })
    await screen.findByText('Use green')
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Copilot' }), {
      target: { value: 'And the logo?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    act(() => handlers.onTextDelta?.('', 'Late text'))
    expect(screen.queryByText('Late text')).toBeNull()
    const stops = state.stop.mock.calls.length
    view.unmount()
    expect(state.stop.mock.calls.length).toBeGreaterThan(stops)
  })
})

describe('announcing answers', () => {
  it('keeps the finished answer in a live region after the draft gives way to the thread', async () => {
    state.threads = [savedThread('workspace:brand', 'Brand', 'Use green')]
    let handlers!: StartAguiTurnOptions['handlers']
    state.start.mockImplementation(
      (options: StartAguiTurnOptions) =>
        new Promise<void>((resolve) => {
          handlers = options.handlers
          setTimeout(resolve, 0)
        })
    )
    mount({ thread: 'workspace:brand' })
    await screen.findByText('Use green')
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Copilot' }), {
      target: { value: 'And the logo?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    act(() =>
      handlers.onFinal?.({
        threadKey: 'workspace:brand',
        messageId: 'answer-1',
        text: 'Upload it in Settings, General.',
        citations: [],
        navigation: [],
        proposedActions: [],
      })
    )
    const live = document.querySelector('[data-slot="copilot-announcer"]') as HTMLElement
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('Upload it in Settings, General.')
  })
})

describe('connector calls', () => {
  function threadWithConnector(): WorkspaceCopilotThread {
    return {
      key: 'workspace:crm',
      title: 'CRM',
      updatedAt: '2026-10-03T00:00:00.000Z',
      messages: [
        {
          id: 'answer',
          sender: 'assistant',
          text: 'I can look this up in Acme CRM.',
          createdAt: '2026-10-03T00:00:00.000Z',
          payload: {
            threadKey: 'workspace:crm',
            messageId: 'answer',
            text: 'I can look this up in Acme CRM.',
            citations: [],
            navigation: [],
            proposedActions: [
              {
                id: 'assistant_action_crm',
                toolName: 'connector_acme__find_order',
                summary: 'Find order A-1',
                label: 'Find order',
                connector: { name: 'Acme CRM', initials: 'AC' },
              },
            ],
          },
        },
      ],
    }
  }

  it('sends nothing on Skip', async () => {
    state.threads = [threadWithConnector()]
    mount({ thread: 'workspace:crm' })
    expect(await screen.findByText('Sends this request to Acme CRM')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(state.decisions).toEqual([['assistant_action_crm', 'rejected']]))
    expect(await screen.findByText('Skipped Acme CRM. Nothing was sent.')).toBeTruthy()
    expect(state.start).not.toHaveBeenCalled()
  })

  it('continues the chat once a read is allowed', async () => {
    state.threads = [threadWithConnector()]
    state.start.mockImplementation(async (options: StartAguiTurnOptions) => {
      expect(options.question).toBe('Go ahead with Acme CRM.')
      expect(options.forwardedProps).toEqual({ threadKey: 'workspace:crm' })
    })
    mount({ thread: 'workspace:crm' })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    expect(state.decisions).toEqual([['assistant_action_crm', 'approved']])
  })
})
