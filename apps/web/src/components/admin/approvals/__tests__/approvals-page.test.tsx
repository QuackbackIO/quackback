// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalView } from '@/lib/server/domains/assistant/approvals.queue'

const state = vi.hoisted(() => ({
  search: {} as { view?: 'decided'; id?: string; d?: string; source?: 'email' | 'app' },
  navigate: vi.fn(),
  waiting: [] as unknown[],
  decided: [] as unknown[],
  approve: vi.fn(),
  emailApprove: vi.fn(),
  reject: vi.fn(),
  getApproval: vi.fn(),
  undo: vi.fn(),
  wide: true,
  listeners: new Set<() => void>(),
  listFails: false,
  waitingCount: null as number | null,
  pageSize: 50,
  bellRead: vi.fn(),
  signInRequest: vi.fn(),
  onSignedIn: null as null | ((action: string) => void),
}))

// The URL as a small store: navigating changes the search the page reads.
function navigateTo({ search }: { search: object | ((previous: object) => object) }) {
  state.search = (typeof search === 'function' ? search(state.search) : search) as never
  for (const listener of state.listeners) listener()
}

vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore, createElement } = await import('react')
  const subscribe = (listener: () => void) => {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  }
  return {
    Link: ({ children, to }: { children: ReactNode; to: string }) =>
      createElement('a', { href: to }, children),
    getRouteApi: () => ({
      useNavigate: () => state.navigate,
      useSearch: () => useSyncExternalStore(subscribe, () => state.search),
    }),
    useRouter: () => ({ invalidate: vi.fn(async () => undefined) }),
  }
})
vi.mock('@/lib/client/hooks/use-media-query', () => ({
  useMediaQuery: () => state.wide,
}))
vi.mock('@/lib/server/functions/approval-counts', () => ({
  getRailCountsFn: async () => ({
    unread: 0,
    waiting: { count: state.waitingCount ?? state.waiting.length, latest: [] },
  }),
}))
vi.mock('@/lib/server/functions/approvals', () => ({
  listApprovalsFn: async ({ data }: { data: { view?: string; cursor?: string } }) => {
    if (state.listFails) throw new Error('Service unavailable')
    const all = (data.view === 'decided' ? state.decided : state.waiting) as Array<{ id: string }>
    const start = data.cursor ? all.findIndex((item) => item.id === data.cursor) + 1 : 0
    const items = all.slice(start, start + state.pageSize)
    const more = start + state.pageSize < all.length
    return { items, nextCursor: more ? items[items.length - 1]!.id : null }
  },
  getApprovalFn: (args: unknown) => state.getApproval(args),
  approveApprovalFn: (args: unknown) => state.approve(args),
  approveApprovalFromEmailFn: (args: unknown) => state.emailApprove(args),
  rejectApprovalFn: (args: unknown) => state.reject(args),
  markApprovalBellReadFn: () => state.bellRead(),
}))
// The real hook and dialog are covered on their own; here the page's use of them.
vi.mock('@/lib/client/hooks/use-sign-in-again', () => ({
  useSignInAgain: (options: { onSignedIn: (action: string) => void }) => {
    state.onSignedIn = options.onSignedIn
    return { request: state.signInRequest, dialog: { open: false } }
  },
}))
vi.mock('@/components/auth/sign-in-again-dialog', () => ({
  SignInAgainDialog: () => <div data-testid="sign-in-again-dialog" />,
}))
vi.mock('@/lib/server/functions/workspace-copilot', () => ({
  undoWorkspaceSettingsProposalFn: (args: unknown) => state.undo(args),
}))
// The settings labels load with Copilot's strings; English renders from the code.
vi.mock('@/components/admin/ask/ask-messages', () => ({
  AskMessages: ({ children }: { children: ReactNode }) => children,
}))

const { ApprovalsPage } = await import('../approvals-page')
const { ApprovalConfirmPage } = await import('../approval-confirm-page')

function view(overrides: Partial<ApprovalView> = {}): ApprovalView {
  const now = Date.now()
  return {
    id: 'assistant_action_01',
    toolName: 'propose_settings_change',
    summary: 'Change the workspace name',
    risk: 'low',
    status: 'proposed',
    parent: { kind: 'thread', id: null },
    requestedVia: 'mcp',
    requestedById: 'principal_key',
    requestedByName: 'Zapier key',
    onBehalfOfPrincipalId: 'principal_james',
    onBehalfOfName: 'James Morton',
    clientName: null,
    proposedAt: new Date(now - 4 * 60_000).toISOString(),
    expiresAt: new Date(now + 23 * 3_600_000).toISOString(),
    contentHash: 'digest-1',
    needsFreshSignIn: false,
    canDecide: true,
    decidedById: null,
    decidedByName: null,
    decidedAt: null,
    decidedVia: null,
    decisionReason: null,
    undoable: false,
    undone: false,
    diff: {
      kind: 'settings',
      changes: [
        {
          id: 'portal.displayName',
          area: 'portal',
          path: ['displayName'],
          before: 'Acme',
          after: 'Acme team',
        },
      ],
    },
    ...overrides,
  }
}

function renderPage(content: ReactNode = <ApprovalsPage />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client = queryClient
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        {content}
      </IntlProvider>
    </QueryClientProvider>
  )
}

let client: QueryClient

beforeEach(() => {
  state.search = {}
  state.wide = true
  state.listFails = false
  state.waitingCount = null
  state.pageSize = 50
  state.bellRead.mockReset()
  state.bellRead.mockResolvedValue({ marked: 0 })
  state.navigate.mockReset()
  state.navigate.mockImplementation(navigateTo)
  state.emailApprove.mockReset()
  state.signInRequest.mockReset()
  state.approve.mockReset()
  state.reject.mockReset()
  state.getApproval.mockReset()
  state.undo.mockReset()
  state.waiting = []
  state.decided = []
})
afterEach(cleanup)

describe('ApprovalsPage', () => {
  it('lists what is waiting, with risk and who asked, and opens the newest beside it', async () => {
    state.waiting = [
      view(),
      view({
        id: 'assistant_action_02',
        summary: 'Close the conversation',
        risk: 'high',
        toolName: 'end_conversation',
        parent: { kind: 'conversation', id: 'conversation_1' },
        proposedAt: new Date(Date.now() - 3_600_000).toISOString(),
        diff: { kind: 'action', args: {} },
      }),
    ]
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Change the workspace name')).toBeInTheDocument()
    expect(within(list).getByText('Close the conversation')).toBeInTheDocument()
    expect(within(list).getByText('High')).toHaveAttribute('data-risk', 'high')
    expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('2')
    const detail = screen.getByRole('heading', { level: 2, name: 'Change the workspace name' })
    expect(detail).toBeInTheDocument()
    expect(screen.getByText('Zapier key', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText('James Morton', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Acme team')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('lists decided requests with their outcome and no decision buttons', async () => {
    state.search = { view: 'decided' }
    state.decided = [
      view({
        status: 'rejected',
        canDecide: false,
        decidedById: 'principal_ada',
        decidedByName: 'Ada Admin',
        decidedAt: new Date().toISOString(),
        decisionReason: 'Keep the name',
      }),
    ]
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getByText(/Rejected/)).toBeInTheDocument()
    expect(screen.getByText('Rejected by Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('Reason: Keep the name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('moves between Waiting and Decided through the URL', async () => {
    state.waiting = [view()]
    renderPage()
    await screen.findByRole('list')
    await waitFor(() => expect(state.search).toEqual({ id: 'assistant_action_01' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Decided' }))
    expect(state.search).toEqual({ view: 'decided', id: undefined })
  })

  it('says when nothing is waiting', async () => {
    renderPage()
    expect(await screen.findByText('Nothing waiting.')).toBeInTheDocument()
  })

  it('asks inline for an optional reason before rejecting', async () => {
    state.waiting = [view()]
    state.reject.mockResolvedValue({
      ok: true,
      approval: view({ status: 'rejected', canDecide: false, decisionReason: 'Not now' }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(state.reject).not.toHaveBeenCalled()
    const reason = screen.getByLabelText('Reason (optional)')
    fireEvent.change(reason, { target: { value: 'Not now' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await screen.findByText('Rejected.')
    expect(state.reject).toHaveBeenCalledWith({
      data: { approvalId: 'assistant_action_01', contentHash: 'digest-1', reason: 'Not now' },
    })
    // The request stays in the list with its outcome.
    expect(within(screen.getByRole('list')).getByText(/Rejected/)).toBeInTheDocument()
  })

  it('lets the reason form be cancelled without deciding', async () => {
    state.waiting = [view()]
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(state.reject).not.toHaveBeenCalled()
  })

  it('approves with the hash it showed and offers Undo where the change can be undone', async () => {
    state.waiting = [view()]
    state.approve.mockResolvedValue({
      ok: true,
      approval: view({ status: 'executed', canDecide: false, undoable: true }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await screen.findByText('Applied just now.')
    expect(state.approve).toHaveBeenCalledWith({
      data: { approvalId: 'assistant_action_01', contentHash: 'digest-1' },
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('says when an applied change can no longer be undone', async () => {
    state.waiting = [view()]
    state.approve.mockResolvedValue({
      ok: true,
      approval: view({ status: 'executed', canDecide: false, undoable: true }),
    })
    state.undo.mockResolvedValue({
      ok: false,
      code: 'SETTINGS_UNDO_CONFLICT',
      message: 'These settings changed since Apply.',
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These settings changed since then. Undo is unavailable.'
    )
    expect(state.undo).toHaveBeenCalledWith({ data: { pendingActionId: 'assistant_action_01' } })
    expect(screen.getByText('Applied just now.')).toBeInTheDocument()
  })

  it('refreshes a request that changed and asks for another look', async () => {
    state.waiting = [view()]
    state.approve.mockResolvedValue({
      ok: false,
      code: 'APPROVAL_CONTENT_CHANGED',
      message: 'This request changed. Review it again.',
    })
    state.getApproval.mockResolvedValue(
      view({
        contentHash: 'digest-2',
        diff: {
          kind: 'settings',
          changes: [
            {
              id: 'portal.displayName',
              area: 'portal',
              path: ['displayName'],
              before: 'Acme',
              after: 'Acme people',
            },
          ],
        },
      })
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This request changed. Review it again.'
    )
    await screen.findByText('Acme people')
    expect(state.getApproval).toHaveBeenCalledWith({ data: { approvalId: 'assistant_action_01' } })
    // The next decision names the content now on screen.
    state.approve.mockResolvedValue({ ok: true, approval: view({ status: 'executed' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(state.approve).toHaveBeenLastCalledWith({
        data: { approvalId: 'assistant_action_01', contentHash: 'digest-2' },
      })
    )
  })

  it('opens the sign-in dialog when a high-risk approve is refused, then approves once after it', async () => {
    state.waiting = [view({ risk: 'high', needsFreshSignIn: true })]
    state.approve.mockResolvedValueOnce({
      ok: false,
      code: 'RECENT_SIGN_IN_REQUIRED',
      message: 'Sign in again to decide this request.',
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(state.signInRequest).toHaveBeenCalledWith('approve:assistant_action_01:digest-1')
    )
    expect(state.approve).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()

    state.approve.mockResolvedValue({ ok: true, approval: view({ status: 'executed' }) })
    act(() => state.onSignedIn!('approve:assistant_action_01:digest-1'))
    await waitFor(() => expect(state.approve).toHaveBeenCalledTimes(2))
    expect(state.approve).toHaveBeenLastCalledWith({
      data: { approvalId: 'assistant_action_01', contentHash: 'digest-1' },
    })
    // A second signal for the same sign-in does not approve again.
    act(() => state.onSignedIn!('approve:assistant_action_01:digest-1'))
    expect(state.approve).toHaveBeenCalledTimes(2)
  })

  it('ignores a resumed action meant for another request', async () => {
    state.waiting = [view({ risk: 'high', needsFreshSignIn: true })]
    renderPage()
    await screen.findByRole('button', { name: 'Approve' })
    act(() => state.onSignedIn!('approve:assistant_action_99'))
    expect(state.approve).not.toHaveBeenCalled()
  })

  it('does not resume approving when the content changed during sign-in', async () => {
    state.waiting = [view({ risk: 'high', contentHash: 'digest-2' })]
    renderPage()
    await screen.findByRole('button', { name: 'Approve' })
    act(() => state.onSignedIn!('approve:assistant_action_01:digest-1'))
    expect(state.approve).not.toHaveBeenCalled()
  })

  it('never asks for a sign-in to reject', async () => {
    state.waiting = [view({ risk: 'high', needsFreshSignIn: true })]
    state.reject.mockResolvedValue({ ok: true, approval: view({ status: 'rejected' }) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(state.reject).toHaveBeenCalled())
    expect(state.signInRequest).not.toHaveBeenCalled()
  })

  it('says how a decided request ended when it is opened from Decided', async () => {
    state.search = { view: 'decided' }
    state.decided = [
      view({
        status: 'executed',
        canDecide: false,
        undone: true,
        decidedById: 'principal_ada',
        decidedByName: 'Ada Admin',
        decidedAt: new Date().toISOString(),
      }),
    ]
    renderPage()
    const heading = await screen.findByRole('heading', { level: 2 })
    const section = heading.closest('section')!
    expect(within(section).getByText('Approved by Ada Admin')).toBeInTheDocument()
    expect(within(section).getByText('Undone')).toBeInTheDocument()
  })

  it('says only that a request was approved while another call carries it out', async () => {
    state.waiting = [view()]
    state.approve.mockResolvedValue({
      ok: true,
      approval: view({ status: 'approved', canDecide: false }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Approved.')
    expect(screen.queryByText(/Applied/)).toBeNull()
  })

  it('moves focus to Undo after approving, and to the result after undoing', async () => {
    state.waiting = [view()]
    state.approve.mockResolvedValue({
      ok: true,
      approval: view({ status: 'executed', canDecide: false, undoable: true }),
    })
    state.undo.mockResolvedValue({ ok: true, id: 'assistant_action_01', status: 'executed' })
    state.getApproval.mockResolvedValue(
      view({ status: 'executed', canDecide: false, undoable: false, undone: true })
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await waitFor(() => expect(undo).toHaveFocus())
    fireEvent.click(undo)
    await screen.findByText('Undone. The previous values are back.')
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
  })

  it('moves focus to the result after a decision with nothing to undo', async () => {
    state.waiting = [view()]
    state.reject.mockResolvedValue({
      ok: true,
      approval: view({ status: 'rejected', canDecide: false }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await screen.findByText('Rejected.')
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
  })

  it('names the area of each change when a request spans more than one', async () => {
    state.waiting = [
      view({
        diff: {
          kind: 'settings',
          changes: [
            {
              id: 'messenger.enabled',
              area: 'messenger',
              path: ['enabled'],
              before: false,
              after: true,
            },
            {
              id: 'portal.displayName',
              area: 'portal',
              path: ['displayName'],
              before: 'Acme',
              after: 'Acme team',
            },
          ],
        },
      }),
    ]
    renderPage()
    expect(await screen.findByText('Messenger: Enabled')).toBeInTheDocument()
    expect(screen.getByText('Portal: Workspace name')).toBeInTheDocument()
  })

  it('keeps the field alone when every change is in one area', async () => {
    state.waiting = [view()]
    renderPage()
    expect(await screen.findByText('Workspace name')).toBeInTheDocument()
  })

  it('shows a brand colour as a swatch and a hex value, never raw oklch', async () => {
    state.waiting = [
      view({
        diff: {
          kind: 'settings',
          changes: [
            {
              id: 'branding.light.primary',
              area: 'branding',
              path: ['light', 'primary'],
              before: 'oklch(0.886 0.176 86)',
              after: '#0f766e',
            },
          ],
        },
      }),
    ]
    renderPage()
    await screen.findByText('#0F766E')
    expect(screen.queryByText(/oklch/)).toBeNull()
    expect(screen.getByText(/^#[0-9A-F]{6}$/, { selector: '.line-through *' })).toBeInTheDocument()
  })

  it('says None for an action field it clears', async () => {
    state.waiting = [
      view({
        toolName: 'set_conversation_attribute',
        parent: { kind: 'conversation', id: 'conversation_1' },
        diff: { kind: 'action', args: { attribute: 'plan', value: null } },
      }),
    ]
    renderPage()
    const row = (await screen.findByText('Value')).closest('div')!
    expect(within(row).getByText('None')).toBeInTheDocument()
    expect(screen.getByText('plan')).toBeInTheDocument()
  })

  it('reads each change as from and to for a screen reader', async () => {
    state.waiting = [view()]
    renderPage()
    const row = (await screen.findByText('Workspace name')).closest('div')!
    expect(within(row).getByText('From', { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(row).getByText('To', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('opens the newest request beside the list once, and keeps it when a newer one arrives', async () => {
    state.waiting = [view()]
    renderPage()
    await waitFor(() => expect(state.search).toEqual({ id: 'assistant_action_01' }))
    state.waiting = [
      view({
        id: 'assistant_action_02',
        summary: 'Turn on Messenger',
        proposedAt: new Date().toISOString(),
      }),
      view(),
    ]
    await act(() => client.refetchQueries())
    await screen.findByText('Turn on Messenger')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Change the workspace name' })
    ).toBeInTheDocument()
    expect(state.search).toEqual({ id: 'assistant_action_01' })
  })

  it('on a phone, opens nothing and marks no row current until one is chosen', async () => {
    state.wide = false
    state.waiting = [view()]
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getByRole('button')).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(state.search).toEqual({})
    // The list column draws its edge only beside the detail, not at the screen edge.
    const column = list.closest('[data-slot="approvals-list"]')!
    expect(column.className).toContain('md:border-r')
    expect(column.className.split(' ')).not.toContain('border-r')
    fireEvent.click(within(list).getByRole('button'))
    expect(within(list).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Change the workspace name' })
    ).toBeInTheDocument()
  })

  it('loads a linked request the tab does not list, never showing another in its place', async () => {
    state.waiting = [view()]
    state.search = { id: 'assistant_action_09' }
    let resolve: (value: ApprovalView) => void = () => undefined
    state.getApproval.mockReturnValue(
      new Promise<ApprovalView>((done) => {
        resolve = done
      })
    )
    renderPage()
    await screen.findByRole('list')
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    await act(async () =>
      resolve(view({ id: 'assistant_action_09', summary: 'Publish the release notes' }))
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Publish the release notes' })
    ).toBeInTheDocument()
    expect(state.search).toEqual({ id: 'assistant_action_09' })
  })

  it('says a linked request was not found when it cannot be read', async () => {
    state.waiting = [view()]
    state.search = { id: 'assistant_action_09' }
    state.getApproval.mockRejectedValue(new Error('This request was not found.'))
    renderPage()
    expect(await screen.findByText('This request was not found.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(state.search).toEqual({ id: 'assistant_action_09' })
  })

  it('says the list could not be loaded instead of showing it empty, and retries', async () => {
    state.listFails = true
    state.waiting = [view()]
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Approvals could not be loaded.')
    expect(screen.queryByText('Nothing waiting.')).toBeNull()
    state.listFails = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await within(await screen.findByRole('list')).findByText('Change the workspace name')
    ).toBeInTheDocument()
  })

  it('says the decided list could not be loaded instead of showing it empty', async () => {
    state.search = { view: 'decided' }
    state.listFails = true
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Approvals could not be loaded.')
    expect(screen.queryByText('Nothing decided yet.')).toBeNull()
  })

  it('reads the approval bell once as the page opens, and refreshes the bell', async () => {
    state.waiting = [view()]
    state.bellRead.mockResolvedValue({ marked: 1 })
    renderPage()
    client.setQueryData(['notifications', 'unreadCount'], 3)
    const list = await screen.findByRole('list')
    await waitFor(() => expect(state.bellRead).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(client.getQueryState(['notifications', 'unreadCount'])?.isInvalidated).toBe(true)
    )
    fireEvent.click(within(list).getByRole('button'))
    expect(state.bellRead).toHaveBeenCalledTimes(1)
  })

  it('counts what waits on the viewer from the same read as the rail and Home', async () => {
    state.waiting = [view()]
    state.waitingCount = 7
    renderPage()
    await screen.findByRole('list')
    await waitFor(() => expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('7'))
  })

  it('reads every page of the list, not only the first', async () => {
    state.pageSize = 1
    state.waiting = [
      view(),
      view({
        id: 'assistant_action_02',
        summary: 'Close the conversation',
        proposedAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    ]
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).queryByText('Close the conversation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await within(list).findByText('Close the conversation')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says an action that can no longer run cannot be approved', async () => {
    state.waiting = [
      view({
        toolName: 'end_conversation',
        parent: { kind: 'conversation', id: 'conversation_1' },
        diff: { kind: 'action', args: {} },
      }),
    ]
    state.approve.mockResolvedValue({
      ok: false,
      code: 'ASSISTANT_TOOL_GONE',
      message: 'The "end_conversation" action is no longer available.',
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This action can no longer be approved.'
    )
  })
})

describe('approval confirmation from a link', () => {
  it('only reads on opening; approval is an explicit click bound to the emailed content', async () => {
    state.search = { id: 'assistant_action_01', d: 'digest-1', source: 'email' }
    state.getApproval.mockResolvedValue(view())
    state.emailApprove.mockResolvedValue({ ok: true, approval: view({ status: 'executed' }) })
    renderPage(<ApprovalConfirmPage />)
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(state.approve).not.toHaveBeenCalled()
    expect(state.emailApprove).not.toHaveBeenCalled()
    fireEvent.click(approve)
    await waitFor(() =>
      expect(state.emailApprove).toHaveBeenCalledWith({
        data: { approvalId: 'assistant_action_01', contentHash: 'digest-1' },
      })
    )
    expect(await screen.findByText('Done. It can’t be undone.')).toBeInTheDocument()
  })

  it('requires another review when the link names old content', async () => {
    state.search = { id: 'assistant_action_01', d: 'old-digest' }
    state.getApproval.mockResolvedValue(view())
    renderPage(<ApprovalConfirmPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This request changed.')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(state.emailApprove).not.toHaveBeenCalled()
  })
})
