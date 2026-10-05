// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AdminOverviewData } from '@/lib/shared/admin-overview'

const { state } = vi.hoisted(() => {
  const data: AdminOverviewData = {
    metrics: [
      {
        key: 'waiting',
        label: 'conversations',
        detail: 'waiting for reply',
        count: 3,
        link: { to: '/admin/inbox' },
        filter: 'support',
      },
      {
        key: 'feedback',
        label: 'ideas',
        detail: 'to review',
        count: 30,
        link: { to: '/admin/feedback' },
        filter: 'feedback',
      },
      {
        key: 'complete',
        label: 'ideas',
        detail: 'with no changelog',
        count: 6,
        link: { to: '/admin/feedback' },
        filter: 'feedback',
      },
      {
        key: 'helpCenter',
        label: 'help center articles',
        detail: 'in draft',
        count: 0,
        link: { to: '/admin/help-center' },
        filter: 'helpCenter',
      },
    ],
    attention: [
      {
        id: 'c1',
        kind: 'support',
        entity: 'conversation',
        title: 'Hello! I have just created my boards in a new cloud workspace',
        link: { to: '/admin/inbox' },
        reason: 'Waiting on reply',
        reasonTone: 'neutral',
        meta: 'Noble Dolphin · waiting 12d',
        ownerName: 'James',
        ownerInitials: 'JM',
        mine: true,
      },
    ],
    momentum: [],
    changelog: [],
    helpCenter: [],
    sections: {
      support: { enabled: true, error: null },
      feedback: { enabled: true, error: null },
      changelog: { enabled: true, error: null },
      helpCenter: { enabled: true, error: null },
    },
  }
  return { state: { data } }
})

vi.mock('@/lib/client/queries/admin-overview', () => ({
  adminOverviewQueries: {
    get: () => ({ queryKey: ['admin', 'overview'] }),
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }),
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
    search,
  }: {
    children: React.ReactNode
    className?: string
    to: string
    search?: Record<string, string | string[] | undefined>
  }) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value == null) continue
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
      else params.set(key, value)
    }
    const query = params.toString()
    return (
      <a href={query ? `${to}?${query}` : to} className={className}>
        {children}
      </a>
    )
  },
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { settings: { name: 'Acme' } }
    return opts?.select ? opts.select(context as never) : context
  },
}))

import { OverviewDashboard } from '../admin-overview'

describe('OverviewDashboard', () => {
  it('keeps a fresh workspace quiet until real data exists', () => {
    const previous = state.data
    state.data = {
      ...state.data,
      hasRealData: false,
      metrics: state.data.metrics.map((metric) => ({ ...metric, count: 0 })),
      attention: [],
    }
    try {
      const { unmount } = render(<OverviewDashboard />)
      expect(screen.queryByText('Conversations waiting for reply')).toBeNull()
      expect(screen.queryByText('Nothing to review')).toBeNull()
      expect(screen.queryByText('0')).toBeNull()
      unmount()
    } finally {
      state.data = previous
    }
  })

  it('keeps the create actions beside a custom Home header', () => {
    render(
      <OverviewDashboard
        header={<h1>Welcome, Acme</h1>}
        actions={<button type="button">Actions</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Acme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
  })

  it('renders each count under a single-line label', () => {
    const { container } = render(<OverviewDashboard />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Conversations waiting for reply')).toBeInTheDocument()
    expect(screen.getByText('Ideas to review')).toBeInTheDocument()
    expect(screen.getByText('Ideas with no changelog')).toBeInTheDocument()
    expect(screen.getByText('Help center articles in draft')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('Feedback')).toBeInTheDocument()

    expect(screen.queryByText('without changelog')).not.toBeInTheDocument()
    expect(screen.queryByText('Complete, no changelog')).not.toBeInTheDocument()
    expect(screen.queryByText('Publishing')).not.toBeInTheDocument()
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    expect(screen.queryByText(/A little context/)).not.toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(screen.queryByText(/Start with customer replies/)).not.toBeInTheDocument()
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument()

    const grid = container.querySelector('.grid.gap-px')
    expect(grid?.className).toContain('grid-cols-2')
    expect(grid?.className).toContain('lg:grid-cols-4')
    expect(grid?.className).not.toContain('grid-cols-3')
  })

  it('has no Team / My work scope control', () => {
    render(<OverviewDashboard />)
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    expect(screen.queryByText('My work')).not.toBeInTheDocument()
  })

  it('keeps attention rows to two lines: title, then reason and meta', () => {
    render(<OverviewDashboard />)
    const title = screen.getByText('Hello! I have just created my boards in a new cloud workspace')
    expect(title.className).toContain('line-clamp-2')
    expect(title.className).toContain('sm:line-clamp-1')
    expect(screen.getByText('Waiting on reply')).toBeInTheDocument()
    expect(screen.getByText('Noble Dolphin · waiting 12d')).toBeInTheDocument()
    expect(title.closest('a')?.querySelector('[data-entity="conversation"]')).not.toBeNull()
  })

  it('opens a feedback item on the current page via ?post=', () => {
    state.data = {
      ...state.data,
      attention: [
        {
          id: 'p1',
          kind: 'feedback',
          entity: 'post',
          title: 'Allow disabling votes',
          link: { to: '/admin', search: { post: 'p1' } },
          reason: 'Open',
          reasonTone: 'info',
          meta: 'Feature Requests · 9d',
          ownerName: null,
          ownerInitials: null,
          mine: false,
        },
      ],
    }
    render(<OverviewDashboard />)
    const title = screen.getByText('Allow disabling votes')
    expect(title.closest('a')).toHaveAttribute('href', '/admin?post=p1')
    expect(title.closest('a')?.querySelector('[data-entity="post"]')).not.toBeNull()
  })

  it('hides the side panel entirely when module desks are empty', () => {
    const { container } = render(<OverviewDashboard />)
    expect(container.querySelector('aside')).toBeNull()
    expect(screen.queryByText('Changelog', { selector: 'h2' })).not.toBeInTheDocument()
    expect(screen.queryByText('Help center', { selector: 'h2' })).not.toBeInTheDocument()
    expect(screen.queryByText('No new votes this week.')).not.toBeInTheDocument()
  })

  it('shows a card per module for non-empty desks', () => {
    state.data = {
      ...state.data,
      changelog: [
        {
          id: 'e1',
          product: 'changelog',
          entity: 'changelog',
          title: 'September updates',
          link: { to: '/admin', search: { entry: 'e1' } },
          status: 'draft',
          meta: 'James',
        },
      ],
      helpCenter: [
        {
          id: 'a1',
          product: 'helpCenter',
          entity: 'article',
          title: 'Environment Variables',
          link: { to: '/admin', search: { article: 'a1' } },
          status: 'draft',
          meta: 'James Morton',
        },
      ],
    }
    const { container } = render(<OverviewDashboard />)
    expect(container.querySelector('aside')).not.toBeNull()
    expect(screen.queryByText('Publishing')).not.toBeInTheDocument()
    expect(screen.queryByText('Momentum')).not.toBeInTheDocument()
    expect(screen.getByText('Changelog', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Help center', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('September updates')).toBeInTheDocument()
    expect(screen.getByText('Environment Variables')).toBeInTheDocument()
    expect(screen.getByText('Environment Variables').closest('a')).toHaveAttribute(
      'href',
      '/admin?article=a1'
    )
    expect(
      screen
        .getByText('Environment Variables')
        .closest('a')
        ?.querySelector('[data-entity="article"]')
    ).not.toBeNull()
  })

  it('keeps successful rail modules when another module fails', () => {
    state.data = {
      ...state.data,
      changelog: [],
      helpCenter: [
        {
          id: 'a1',
          product: 'helpCenter',
          entity: 'article',
          title: 'Environment Variables',
          link: { to: '/admin', search: { article: 'a1' } },
          status: 'draft',
          meta: 'James Morton',
        },
      ],
      sections: {
        ...state.data.sections,
        changelog: { enabled: true, error: 'Couldn’t load this section.' },
        helpCenter: { enabled: true, error: null },
      },
    }
    render(<OverviewDashboard />)
    expect(screen.getByText('Changelog', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load this section.')).toBeInTheDocument()
    expect(screen.getByText('Help center', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Environment Variables')).toBeInTheDocument()
    expect(screen.queryByText('Feedback', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('surfaces a feed failure next to successful attention items', () => {
    state.data = {
      ...state.data,
      attention: [
        {
          id: 'c1',
          kind: 'support',
          entity: 'conversation',
          title: 'Hello! I have just created my boards in a new cloud workspace',
          link: { to: '/admin/inbox' },
          reason: 'Waiting on reply',
          reasonTone: 'neutral',
          meta: 'Noble Dolphin · waiting 12d',
          ownerName: 'James',
          ownerInitials: 'JM',
          mine: true,
        },
      ],
      changelog: [],
      helpCenter: [],
      sections: {
        support: { enabled: true, error: null },
        feedback: { enabled: true, error: 'Couldn’t load this section.' },
        changelog: { enabled: true, error: null },
        helpCenter: { enabled: true, error: null },
      },
    }
    render(<OverviewDashboard />)
    expect(
      screen.getByText('Hello! I have just created my boards in a new cloud workspace')
    ).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load this section.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing to review')).not.toBeInTheDocument()
  })

  it('is titled Home with the standard page header', () => {
    const { container } = render(<OverviewDashboard />)
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(container.querySelector('[data-page-header]')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('filters the list with standard line tabs', () => {
    render(<OverviewDashboard />)
    expect(screen.getByRole('tab', { name: 'All' }).closest('[data-variant="line"]')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Support' })).toBeInTheDocument()
  })

  it('says Nothing to review when the list is empty', () => {
    state.data = {
      ...state.data,
      attention: [],
      sections: {
        support: { enabled: true, error: null },
        feedback: { enabled: true, error: null },
        changelog: { enabled: true, error: null },
        helpCenter: { enabled: true, error: null },
      },
    }
    render(<OverviewDashboard />)
    expect(screen.getByText('Nothing to review')).toBeInTheDocument()
    expect(screen.queryByText(/caught up/i)).not.toBeInTheDocument()
  })
})
