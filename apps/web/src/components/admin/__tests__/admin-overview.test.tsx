// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AdminOverviewData } from '@/lib/shared/admin-overview'

const { state } = vi.hoisted(() => {
  const data: AdminOverviewData = {
    metrics: [
      {
        key: 'waiting',
        label: 'waiting for reply',
        count: 3,
        link: { to: '/admin/inbox' },
        filter: 'support',
      },
      {
        key: 'feedback',
        label: 'to review',
        count: 30,
        link: { to: '/admin/feedback' },
        filter: 'feedback',
      },
      {
        key: 'complete',
        label: 'without changelog',
        count: 6,
        link: { to: '/admin/feedback' },
        filter: 'publishing',
      },
      {
        key: 'articles',
        label: 'article drafts',
        count: 0,
        link: { to: '/admin/help-center' },
        filter: 'articles',
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
    publishing: [],
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
  useRouteContext: () => ({ settings: { name: 'Acme' } }),
}))

import { OverviewDashboard } from '../admin-overview'

describe('OverviewDashboard', () => {
  it('renders counts as a single phrase with no units, hints, or captions', () => {
    const { container } = render(<OverviewDashboard />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('waiting for reply')).toBeInTheDocument()
    expect(screen.getByText('to review')).toBeInTheDocument()
    expect(screen.getByText('without changelog')).toBeInTheDocument()
    expect(screen.getByText('article drafts')).toBeInTheDocument()

    expect(screen.queryByText('open')).not.toBeInTheDocument()
    expect(screen.queryByText('drafts')).not.toBeInTheDocument()
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

  it('hides the side panel entirely when momentum and publishing are empty', () => {
    const { container } = render(<OverviewDashboard />)
    expect(container.querySelector('aside')).toBeNull()
    expect(screen.queryByText('Momentum')).not.toBeInTheDocument()
    expect(screen.queryByText('Publishing', { selector: 'h2' })).not.toBeInTheDocument()
    expect(screen.queryByText('No new votes this week.')).not.toBeInTheDocument()
  })

  it('shows only the non-empty side groups', () => {
    state.data = {
      ...state.data,
      publishing: [
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
    expect(screen.queryByText('Momentum')).not.toBeInTheDocument()
    expect(screen.getByText('Publishing', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Environment Variables')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('James Morton')).toBeInTheDocument()
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
})
