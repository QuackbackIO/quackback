// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

type ComponentProps = {
  children?: ReactNode
  onClick?: () => void
}

type RouteOptions = {
  loader: (input: {
    context: {
      queryClient: {
        ensureQueryData: (query: unknown) => Promise<unknown>
        setQueryData: (key: unknown, value: unknown) => void
      }
      settings: Record<string, unknown>
      session?: { user?: { id?: string } } | null
    }
    location: { search: Record<string, unknown> }
  }) => Promise<Record<string, unknown>>
  component: () => ReactElement | null
}

const mocks = vi.hoisted(() => ({
  loaderData: null as unknown,
  search: {} as Record<string, unknown>,
  ensureSession: vi.fn(async () => undefined),
  resolveWidgetContextFn: vi.fn(),
  getSupportSurfaceAccessFn: vi.fn(async () => ({ granted: true })),
  getChatPresenceFn: vi.fn(async () => ({ state: 'online' })),
  fetchBoardCapabilitiesFn: vi.fn(async () => ({
    'board-1': { canSubmit: true, canVote: true },
  })),
  getWidgetAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer widget' })),
  ensureQueryData: vi.fn(),
  setQueryData: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.search,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useQuery: (options: { initialData?: unknown; queryFn?: () => unknown }) => ({
    data: options.initialData,
  }),
}))

vi.mock('@/lib/server/functions/widget-context', () => ({
  resolveWidgetContextFn: mocks.resolveWidgetContextFn,
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getSupportSurfaceAccessFn: mocks.getSupportSurfaceAccessFn,
  getChatPresenceFn: mocks.getChatPresenceFn,
}))

vi.mock('@/lib/server/functions/portal', () => ({
  fetchBoardCapabilitiesFn: mocks.fetchBoardCapabilitiesFn,
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://portal.test',
}))

vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: mocks.getWidgetAuthHeaders,
}))

vi.mock('@/lib/client/hooks/use-widget-vote', () => ({
  INITIAL_SESSION_VERSION: 0,
  widgetQueryKeys: {
    votedPosts: {
      bySession: (version: number) => ['voted-posts', version],
    },
  },
}))

vi.mock('@/components/widget/use-chat-presence', () => ({
  CHAT_PRESENCE_QUERY_KEY: ['chat-presence'],
}))

vi.mock('@/lib/client/queries/portal', () => ({
  portalQueries: {
    portalData: (params: unknown) => ({ queryKey: ['portalData'], params }),
  },
}))

vi.mock('@/components/widget/widget-auth-provider', () => ({
  useWidgetAuth: () => ({ ensureSession: mocks.ensureSession, sessionVersion: 0 }),
}))

vi.mock('@/components/widget/widget-vote-button', () => ({
  WidgetVoteButton: ({
    onBeforeVote,
    noAccessReason,
  }: {
    onBeforeVote?: () => void
    noAccessReason?: string
  }) => (
    <button type="button" onClick={onBeforeVote}>
      Vote {noAccessReason ?? 'allowed'}
    </button>
  ),
}))

vi.mock('@/components/widget/widget-shell', () => ({
  WidgetShell: ({
    children,
    onBack,
    onTabChange,
  }: ComponentProps & {
    onBack?: () => void
    onTabChange: (tab: 'home' | 'feedback' | 'changelog' | 'help') => void
  }) => (
    <section>
      {onBack ? (
        <button type="button" onClick={onBack}>
          Shell back
        </button>
      ) : null}
      <button type="button" onClick={() => onTabChange('home')}>
        Tab home
      </button>
      <button type="button" onClick={() => onTabChange('feedback')}>
        Tab feedback
      </button>
      <button type="button" onClick={() => onTabChange('changelog')}>
        Tab changelog
      </button>
      <button type="button" onClick={() => onTabChange('help')}>
        Tab help
      </button>
      {children}
    </section>
  ),
}))

vi.mock('@/components/widget/widget-overview', () => ({
  WidgetOverview: ({
    onLeaveFeedback,
    onGetHelp,
    onOpenSupport,
    onResumeChat,
    onSeeChangelog,
    onOpenChangelogEntry,
  }: {
    onLeaveFeedback: () => void
    onGetHelp: () => void
    onOpenSupport?: () => void
    onResumeChat: () => void
    onSeeChangelog: () => void
    onOpenChangelogEntry: (id: string) => void
  }) => (
    <div>
      Overview
      <button type="button" onClick={onLeaveFeedback}>
        Leave feedback
      </button>
      <button type="button" onClick={onGetHelp}>
        Get help
      </button>
      <button type="button" onClick={onOpenSupport}>
        Open support
      </button>
      <button type="button" onClick={onResumeChat}>
        Resume chat
      </button>
      <button type="button" onClick={onSeeChangelog}>
        See changelog
      </button>
      <button type="button" onClick={() => onOpenChangelogEntry('entry-1')}>
        Open changelog entry
      </button>
    </div>
  ),
}))

vi.mock('@/components/widget/widget-home', () => ({
  WidgetHome: ({
    initialPosts,
    onPostSelect,
    onPostCreated,
    supportSlot,
  }: {
    initialPosts: Array<{ id: string; title: string }>
    onPostSelect: (id: string) => void
    onPostCreated: (post: {
      id: string
      title: string
      voteCount: number
      statusId: string | null
      board: { id: string; name: string; slug: string }
    }) => void
    supportSlot?: ReactNode
  }) => (
    <div>
      Feedback home {initialPosts.map((post) => post.title).join(',')}
      <button type="button" onClick={() => onPostSelect(initialPosts[0]?.id ?? 'post-1')}>
        Open post
      </button>
      <button
        type="button"
        onClick={() =>
          onPostCreated({
            id: 'created-1',
            title: 'Created idea',
            voteCount: 3,
            statusId: 'status-1',
            board: { id: 'board-1', name: 'Ideas', slug: 'ideas' },
          })
        }
      >
        Create post
      </button>
      {supportSlot}
    </div>
  ),
}))

vi.mock('@/components/widget/widget-post-detail', () => ({
  WidgetPostDetail: ({ postId }: { postId: string }) => <div>Post detail {postId}</div>,
}))

vi.mock('@/components/widget/widget-changelog', () => ({
  WidgetChangelog: ({ onEntrySelect }: { onEntrySelect: (id: string) => void }) => (
    <button type="button" onClick={() => onEntrySelect('entry-2')}>
      Changelog list
    </button>
  ),
}))

vi.mock('@/components/widget/widget-changelog-detail', () => ({
  WidgetChangelogDetail: ({ entryId }: { entryId: string }) => (
    <div>Changelog detail {entryId}</div>
  ),
}))

vi.mock('@/components/widget/widget-help', () => ({
  WidgetHelp: ({
    onArticleSelect,
    onCategorySelect,
    onOpenChat,
    onOpenSupport,
  }: {
    onArticleSelect: (slug: string) => void
    onCategorySelect: (id: string, name: string, icon: string | null) => void
    onOpenChat?: () => void
    onOpenSupport?: () => void
  }) => (
    <div>
      Help root
      <button type="button" onClick={() => onArticleSelect('article-1')}>
        Open article
      </button>
      <button type="button" onClick={() => onCategorySelect('cat-1', 'Guides', null)}>
        Open category
      </button>
      <button type="button" onClick={onOpenChat}>
        Open chat
      </button>
      <button type="button" onClick={onOpenSupport}>
        Open help support
      </button>
    </div>
  ),
}))

vi.mock('@/components/widget/widget-help-category', () => ({
  WidgetHelpCategory: ({
    categoryName,
    onArticleSelect,
  }: {
    categoryName: string
    onArticleSelect: (slug: string) => void
  }) => (
    <div>
      Category {categoryName}
      <button type="button" onClick={() => onArticleSelect('category-article')}>
        Open category article
      </button>
    </div>
  ),
}))

vi.mock('@/components/widget/widget-help-detail', () => ({
  WidgetHelpDetail: ({ articleSlug }: { articleSlug: string }) => (
    <div>Help detail {articleSlug}</div>
  ),
}))

vi.mock('@/components/widget/widget-live-chat', () => ({
  WidgetLiveChat: ({ conversationTarget }: { conversationTarget?: string }) => (
    <div>Live chat {conversationTarget ?? 'active'}</div>
  ),
}))

vi.mock('@/components/widget/widget-messages-section', () => ({
  WidgetMessagesSection: ({ onOpenChat }: { onOpenChat: (target?: 'new') => void }) => (
    <button type="button" onClick={() => onOpenChat('new')}>
      Messages root
    </button>
  ),
}))

vi.mock('@/components/widget/widget-support-card', () => ({
  WidgetSupportCard: ({ onOpen }: { onOpen: () => void }) => (
    <button type="button" onClick={onOpen}>
      Support card
    </button>
  ),
}))

vi.mock('@/components/widget/widget-support-list', () => ({
  WidgetSupportList: ({
    onNewTicket,
    onTicketSelect,
  }: {
    onNewTicket: () => void
    onTicketSelect: (id: string) => void
  }) => (
    <div>
      Support list
      <button type="button" onClick={onNewTicket}>
        New ticket
      </button>
      <button type="button" onClick={() => onTicketSelect('ticket-1')}>
        Existing ticket
      </button>
    </div>
  ),
}))

vi.mock('@/components/widget/widget-support-new', () => ({
  WidgetSupportNew: ({ onCreated }: { onCreated: (ticket: { id: string }) => void }) => (
    <button type="button" onClick={() => onCreated({ id: 'ticket-new' })}>
      Create support ticket
    </button>
  ),
}))

vi.mock('@/components/widget/widget-support-detail', () => ({
  WidgetSupportDetail: ({ ticketId }: { ticketId: string }) => <div>Support detail {ticketId}</div>,
}))

const { Route } = await import('../index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function portalData() {
  return {
    votedPostIds: ['post-1'],
    boards: [
      { id: 'board-1', name: 'Ideas', slug: 'ideas' },
      { id: 'board-2', name: 'Bugs', slug: 'bugs' },
    ],
    boardPermissions: {
      'board-1': { canSubmit: true, canVote: true },
      'board-2': { canSubmit: false, canVote: false },
    },
    posts: {
      items: [
        {
          id: 'post-1',
          title: 'Visible idea',
          voteCount: 5,
          statusId: 'status-1',
          commentCount: 2,
          board: { id: 'board-1', name: 'Ideas', slug: 'ideas' },
        },
        {
          id: 'post-2',
          title: 'Filtered bug',
          voteCount: 1,
          statusId: 'status-2',
          commentCount: 0,
          board: { id: 'board-2', name: 'Bugs', slug: 'bugs' },
        },
      ],
      hasMore: true,
    },
    statuses: [
      { id: 'status-1', name: 'Open', color: '#00f' },
      { id: 'status-2', name: 'Closed', color: '#999' },
    ],
  }
}

function widgetContext(overrides: Record<string, unknown> = {}) {
  return {
    publicConfig: {
      enabled: true,
      defaultBoard: 'bugs',
      tabs: { home: true, feedback: true, changelog: true, help: true, chat: true },
      chat: { enabled: true },
      imageUploadsInWidget: false,
      ticketing: { enabled: true },
    },
    contentFilters: {
      feedback: { boardIds: ['board-1'], statusIds: ['status-1'] },
      changelog: { mode: 'selected_entries', entryIds: ['entry-1'] },
    },
    supportConfig: {
      categories: [
        { categoryKey: 'billing', label: 'Billing', visible: true },
        { categoryKey: 'hidden', label: 'Hidden', visible: false },
      ],
    },
    ...overrides,
  }
}

function loaderContext() {
  return {
    queryClient: {
      ensureQueryData: mocks.ensureQueryData,
      setQueryData: mocks.setQueryData,
    },
    settings: {
      slug: 'acme',
      featureFlags: { supportInbox: true, helpCenter: true, linkPreviews: true },
      helpCenterConfig: { enabled: true },
      publicPortalConfig: { portalAccess: { isPrivate: true, widgetSignIn: true } },
    },
    session: { user: { id: 'user-1' } },
  }
}

function seedEnabledLoaderData(overrides: Record<string, unknown> = {}) {
  mocks.loaderData = {
    widgetEnabled: true,
    posts: portalData().posts.items.slice(0, 1),
    postsHasMore: true,
    statuses: portalData().statuses,
    boards: portalData().boards,
    orgSlug: 'acme',
    boardPermissions: portalData().boardPermissions,
    tabs: { home: true, feedback: true, changelog: true, help: true, chat: true },
    linkPreviews: true,
    defaultBoard: 'ideas',
    imageUploadsInWidget: true,
    ticketingEnabled: true,
    supportCategories: [{ categoryKey: 'billing', label: 'Billing' }],
    chatConfigured: true,
    portalAccess: { isPrivate: false, widgetSignIn: false },
    portalOrigin: 'https://portal.test',
    ...overrides,
  }
}

function dispatchHostOpenMessage(data: { view?: string; ticketId?: string }) {
  const event = new MessageEvent('message', {
    data: { type: 'quackback:open', data },
  })
  Object.defineProperty(event, 'source', { value: window.parent })
  act(() => {
    window.dispatchEvent(event)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = {}
  mocks.resolveWidgetContextFn.mockResolvedValue(widgetContext())
  mocks.ensureQueryData.mockResolvedValue(portalData())
})

describe('widget route loader', () => {
  it('returns a disabled widget payload without loading portal data', async () => {
    mocks.resolveWidgetContextFn.mockResolvedValueOnce(
      widgetContext({ publicConfig: { enabled: false } })
    )

    const result = await routeOptions().loader({
      context: loaderContext(),
      location: {
        search: { applicationKey: 'app', environment: 'prod', hostOrigin: 'https://app.test' },
      },
    })

    expect(mocks.resolveWidgetContextFn).toHaveBeenCalledWith({
      data: {
        applicationKey: 'app',
        environment: 'prod',
        hostOrigin: 'https://app.test',
      },
    })
    expect(result.widgetEnabled).toBe(false)
    expect(result.portalOrigin).toBe('https://portal.test')
    expect(mocks.ensureQueryData).not.toHaveBeenCalled()
  })

  it('filters boards, posts, statuses, support categories, and seeds widget caches', async () => {
    const result = await routeOptions().loader({
      context: loaderContext(),
      location: { search: { app: 'legacy-app', env: 'staging', board: 'ideas' } },
    })

    expect(result.widgetEnabled).toBe(true)
    expect(result.boards).toEqual([{ id: 'board-1', name: 'Ideas', slug: 'ideas' }])
    expect(result.posts).toEqual([
      {
        id: 'post-1',
        title: 'Visible idea',
        voteCount: 5,
        statusId: 'status-1',
        commentCount: 2,
        board: { id: 'board-1', name: 'Ideas', slug: 'ideas' },
      },
    ])
    expect(result.statuses).toEqual([{ id: 'status-1', name: 'Open', color: '#00f' }])
    expect(result.defaultBoard).toBe('ideas')
    expect(result.tabs).toEqual({
      home: true,
      feedback: true,
      changelog: true,
      help: true,
      chat: true,
    })
    expect(result.supportCategories).toEqual([
      {
        categoryKey: 'billing',
        label: 'Billing',
        description: undefined,
        icon: undefined,
        defaultPriority: undefined,
        allowedPriorities: undefined,
        display: undefined,
      },
    ])
    expect(mocks.setQueryData).toHaveBeenCalledWith(['voted-posts', 0], expect.any(Set))
    expect(mocks.setQueryData).toHaveBeenCalledWith(['chat-presence'], { state: 'online' })
  })
})

describe('widget route component', () => {
  it('renders nothing when the widget is disabled', () => {
    mocks.loaderData = { widgetEnabled: false }
    const Component = routeOptions().component
    const { container } = render(<Component />)

    expect(container.textContent).toBe('')
  })

  it('navigates between overview, support, help, changelog, chat, feedback, and success views', async () => {
    seedEnabledLoaderData()
    const Component = routeOptions().component
    render(<Component />)

    expect(screen.getByText('Overview')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open support' }))
    expect(screen.getByText('Support list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create support ticket' }))
    expect(screen.getByText('Support detail ticket-new')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shell back' }))
    expect(screen.getByText('Support list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shell back' }))
    expect(screen.getByText('Overview')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Get help' }))
    expect(screen.getByText('Help root')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open category' }))
    expect(screen.getByText('Category Guides')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open category article' }))
    expect(screen.getByText('Help detail category-article')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shell back' }))
    expect(screen.getByText('Category Guides')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shell back' }))
    expect(screen.getByText('Help root')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open article' }))
    expect(screen.getByText('Help detail article-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tab home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open changelog entry' }))
    expect(screen.getByText('Changelog detail entry-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shell back' }))
    expect(screen.getByRole('button', { name: 'Changelog list' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tab help' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(screen.getByText('Live chat active')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tab feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
    expect(screen.getByText('Thanks for your feedback!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vote allowed' }))
    await waitFor(() => expect(mocks.ensureSession).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('Created idea'))
    expect(screen.getByText('Post detail created-1')).toBeTruthy()
  })

  it('opens support and changelog from host messages and chat from a deep link', () => {
    seedEnabledLoaderData()
    mocks.search = { c: 'conversation-1' }
    const Component = routeOptions().component
    render(<Component />)

    expect(screen.getByText('Live chat conversation-1')).toBeTruthy()

    dispatchHostOpenMessage({ view: 'support', ticketId: 'ticket-2' })
    expect(screen.getByText('Support detail ticket-2')).toBeTruthy()

    dispatchHostOpenMessage({ view: 'changelog' })
    expect(screen.getByRole('button', { name: 'Changelog list' })).toBeTruthy()
  })
})
