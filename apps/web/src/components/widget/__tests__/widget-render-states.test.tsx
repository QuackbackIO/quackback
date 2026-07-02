// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WidgetChangelog } from '../widget-changelog'
import { WidgetChangelogDetail } from '../widget-changelog-detail'
import { WidgetChangelogTeaser } from '../widget-changelog-teaser'
import { WidgetConversationHistory } from '../widget-conversation-history'
import { WidgetHelpCategory } from '../widget-help-category'
import { WidgetHelpDetail } from '../widget-help-detail'
import { WidgetSupportList } from '../widget-support-list'

type QueryResult = {
  data?: unknown
  isLoading?: boolean
  error?: unknown
}

type InfiniteResult = {
  data?: { pages: Array<{ items: Array<Record<string, unknown>> }> }
  fetchNextPage?: () => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  isLoading?: boolean
}

const mocks = vi.hoisted(() => ({
  isIdentified: true,
  queryResults: new Map<string, QueryResult>(),
  infiniteResult: {
    data: { pages: [{ items: [] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  } as InfiniteResult,
  fetchNextPage: vi.fn(),
  sendToHost: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    mocks.queryResults.get(String(options.queryKey[0])) ?? { data: undefined, isLoading: false },
  useInfiniteQuery: () => ({
    fetchNextPage: mocks.fetchNextPage,
    ...mocks.infiniteResult,
  }),
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  }),
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({
    children,
  }: {
    children: ReactNode
    className?: string
    scrollBarClassName?: string
  }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}))

vi.mock('@/components/shared/embed-hydration', () => ({
  EmbedHydration: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  isRichTextContent: (content: unknown) =>
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as { type?: string }).type === 'doc',
  RichTextContent: ({
    content,
  }: {
    content: { content?: Array<{ content?: Array<{ text?: string }> }> }
  }) => (
    <div data-testid="rich-text">
      {content.content
        ?.flatMap((node) => node.content ?? [])
        .map((node) => node.text)
        .join('')}
    </div>
  ),
}))

vi.mock('@/components/help-center/category-icon', () => ({
  CategoryIcon: ({ icon }: { icon: string; className?: string }) => <span>{icon}</span>,
}))

vi.mock('@/lib/client/queries/changelog', () => ({
  publicChangelogQueries: {
    list: () => ({ queryKey: ['changelog-list'] }),
    detail: (entryId: string) => ({ queryKey: ['changelog-detail', entryId] }),
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  publicHelpCenterQueries: {
    articlesForCategory: (categoryId: string) => ({ queryKey: ['help-category', categoryId] }),
    articleBySlug: (slug: string) => ({ queryKey: ['help-detail', slug] }),
  },
}))

vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: ({
    hasMore,
    isFetching,
    onLoadMore,
  }: {
    hasMore: boolean
    isFetching: boolean
    onLoadMore: () => void
  }) => {
    if (hasMore && !isFetching) onLoadMore()
    return vi.fn()
  },
}))

vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer widget' }),
}))

vi.mock('@/lib/client/widget-bridge', () => ({
  sendToHost: (message: unknown) => mocks.sendToHost(message),
}))

vi.mock('@/lib/client/widget/tickets-api', () => ({
  listWidgetTickets: vi.fn(),
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    isIdentified: mocks.isIdentified,
    sessionVersion: 7,
  }),
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowTopRightOnSquareIcon: () => <span aria-hidden="true">external</span>,
  ChevronRightIcon: () => <span aria-hidden="true">chevron</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChevronRightIcon: () => <span aria-hidden="true">chevron</span>,
  NewspaperIcon: () => <span aria-hidden="true">news</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isIdentified = true
  mocks.queryResults = new Map()
  mocks.infiniteResult = {
    data: { pages: [{ items: [] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }
})

describe('WidgetSupportList', () => {
  it('renders anonymous, error, empty, and ticket row states', () => {
    const onNewTicket = vi.fn()
    const onTicketSelect = vi.fn()
    mocks.isIdentified = false

    const { rerender } = render(
      <WidgetSupportList onNewTicket={onNewTicket} onTicketSelect={onTicketSelect} />
    )

    expect(screen.getByText('Sign in to view your tickets.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /New ticket/ }))
    expect(onNewTicket).toHaveBeenCalledTimes(1)

    mocks.isIdentified = true
    mocks.queryResults.set('widget', { error: new Error('boom') })
    rerender(<WidgetSupportList onNewTicket={onNewTicket} onTicketSelect={onTicketSelect} />)
    expect(screen.getByText('Could not load your tickets.')).toBeInTheDocument()

    mocks.queryResults.set('widget', { data: { rows: [] } })
    rerender(
      <WidgetSupportList
        onNewTicket={onNewTicket}
        onTicketSelect={onTicketSelect}
        categories={[{ display: { emptyStateDescription: 'No support history yet' } } as never]}
      />
    )
    expect(screen.getByText('No support history yet')).toBeInTheDocument()

    mocks.queryResults.set('widget', {
      data: {
        rows: [
          {
            id: 'ticket_1',
            subject: 'Invoice is missing',
            statusCategory: 'open',
            statusColor: '#0ea5e9',
            statusName: 'Open',
            lastActivityAt: '2026-06-20T10:00:00.000Z',
          },
          {
            id: 'ticket_2',
            subject: 'Bug is fixed',
            statusCategory: 'solved',
            statusColor: null,
            statusName: 'Solved',
            lastActivityAt: '2026-06-20T11:00:00.000Z',
          },
        ],
      },
    })
    rerender(<WidgetSupportList onNewTicket={onNewTicket} onTicketSelect={onTicketSelect} />)

    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Invoice is missing/ }))
    expect(onTicketSelect).toHaveBeenCalledWith('ticket_1')
  })
})

describe('widget changelog views', () => {
  it('renders changelog empty and populated states', () => {
    const onEntrySelect = vi.fn()
    const { rerender } = render(<WidgetChangelog onEntrySelect={onEntrySelect} />)

    expect(screen.getByText('No updates yet')).toBeInTheDocument()

    mocks.infiniteResult = {
      data: {
        pages: [
          {
            items: [
              {
                id: 'changelog_1',
                title: 'Billing filters shipped',
                content: 'A long description for the changelog entry.',
                publishedAt: '2026-06-20T10:00:00.000Z',
              },
            ],
          },
        ],
      },
      hasNextPage: true,
      isFetchingNextPage: true,
      isLoading: false,
    }
    rerender(<WidgetChangelog onEntrySelect={onEntrySelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Billing filters shipped/ }))
    expect(onEntrySelect).toHaveBeenCalledWith('changelog_1')
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders the latest changelog teaser and opens entries', () => {
    const onOpenEntry = vi.fn()
    const onSeeAll = vi.fn()
    mocks.infiniteResult = {
      data: {
        pages: [
          {
            items: [
              {
                id: 'changelog_1',
                title: 'New billing dashboard',
                content: 'Short body',
                publishedAt: '2026-06-20T10:00:00.000Z',
              },
            ],
          },
        ],
      },
    }

    render(<WidgetChangelogTeaser onOpenEntry={onOpenEntry} onSeeAll={onSeeAll} />)

    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    fireEvent.click(screen.getByRole('button', { name: /New billing dashboard/ }))

    expect(onSeeAll).toHaveBeenCalled()
    expect(onOpenEntry).toHaveBeenCalledWith('changelog_1')
  })

  it('renders changelog detail states and portal navigation', () => {
    const { rerender } = render(<WidgetChangelogDetail entryId="changelog_1" />)

    expect(screen.getByText('Entry not found')).toBeInTheDocument()

    mocks.queryResults.set('changelog-detail', {
      data: {
        id: 'changelog_1',
        title: 'Launch notes',
        content: 'Plain launch notes',
        contentJson: null,
        publishedAt: '2026-06-20T10:00:00.000Z',
      },
    })
    rerender(<WidgetChangelogDetail entryId="changelog_1" />)

    expect(screen.getByText('Plain launch notes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Launch notes/ }))
    expect(mocks.sendToHost).toHaveBeenCalledWith({
      type: 'quackback:navigate',
      url: expect.stringContaining('/changelog/changelog_1'),
    })

    mocks.queryResults.set('changelog-detail', {
      data: {
        id: 'changelog_1',
        title: 'Launch notes',
        content: '',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich notes' }] }],
        },
        publishedAt: '2026-06-20T10:00:00.000Z',
      },
    })
    rerender(<WidgetChangelogDetail entryId="changelog_1" />)
    expect(screen.getByTestId('rich-text')).toHaveTextContent('Rich notes')
  })
})

describe('widget help views', () => {
  it('renders category articles and selects an article', () => {
    const onArticleSelect = vi.fn()
    mocks.queryResults.set('help-category', {
      data: [
        {
          id: 'article_1',
          slug: 'billing-setup',
          title: 'Set up billing',
          description: 'Connect invoices and receipts',
        },
      ],
    })

    render(
      <WidgetHelpCategory
        categoryId="cat_1"
        categoryName="Billing"
        categoryIcon="credit-card"
        onArticleSelect={onArticleSelect}
      />
    )

    expect(screen.getByText('credit-card')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Set up billing/ }))
    expect(onArticleSelect).toHaveBeenCalledWith('billing-setup')
  })

  it('renders help detail content and portal navigation', () => {
    const { rerender } = render(<WidgetHelpDetail articleSlug="billing-setup" />)
    expect(screen.getByText('Article not found')).toBeInTheDocument()

    mocks.queryResults.set('help-detail', {
      data: {
        title: 'Set up billing',
        slug: 'billing-setup',
        content: 'Plain article',
        contentJson: null,
        category: { name: 'Billing', slug: 'billing' },
      },
    })
    rerender(<WidgetHelpDetail articleSlug="billing-setup" />)

    expect(screen.getByText('Plain article')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Set up billing/ }))
    expect(mocks.sendToHost).toHaveBeenCalledWith({
      type: 'quackback:navigate',
      url: expect.stringContaining('/hc/articles/billing/billing-setup'),
    })
  })
})

describe('WidgetConversationHistory', () => {
  it('filters the active conversation and opens previous conversations', () => {
    const onSelect = vi.fn()
    mocks.queryResults.set('widget', {
      data: {
        conversations: [
          {
            id: 'conversation_active',
            subject: 'Current chat',
            status: 'open',
            lastMessageAt: '2026-06-20T10:00:00.000Z',
          },
          {
            id: 'conversation_prior',
            subject: '',
            lastMessagePreview: 'Previous billing question',
            status: 'pending',
            lastMessageAt: '2026-06-19T10:00:00.000Z',
          },
        ],
      },
    })

    render(
      <WidgetConversationHistory activeId={'conversation_active' as never} onSelect={onSelect} />
    )

    expect(screen.queryByText('Current chat')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Previous billing question/ }))
    expect(onSelect).toHaveBeenCalledWith('conversation_prior')
    expect(screen.getByText(/Awaiting you/)).toBeInTheDocument()
  })
})
