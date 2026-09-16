// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AdminOverviewData } from '@/lib/shared/admin-overview'

const { overview } = vi.hoisted(() => {
  const data: AdminOverviewData = {
    generatedAt: '2026-09-16T19:00:00.000Z',
    scope: 'team',
    metrics: [
      {
        key: 'waiting',
        label: 'Waiting for reply',
        count: 3,
        unit: 'open',
        hint: '',
        hintTone: 'neutral',
        link: { to: '/admin/inbox' },
        filter: 'support',
      },
      {
        key: 'feedback',
        label: 'Feedback to review',
        count: 30,
        unit: 'open',
        hint: '',
        hintTone: 'neutral',
        link: { to: '/admin/feedback' },
        filter: 'feedback',
      },
      {
        key: 'complete',
        label: 'No changelog',
        count: 6,
        unit: 'open',
        hint: '',
        hintTone: 'neutral',
        link: { to: '/admin/feedback' },
        filter: 'publishing',
      },
      {
        key: 'articles',
        label: 'Article drafts',
        count: 0,
        unit: 'drafts',
        hint: '',
        hintTone: 'neutral',
        link: { to: '/admin/help-center' },
        filter: 'articles',
      },
    ],
    attention: [
      {
        id: 'c1',
        kind: 'support',
        title: 'Hello! I have just created my boards in a new cloud workspace',
        link: { to: '/admin/inbox' },
        reason: 'Waiting on reply',
        reasonTone: 'neutral',
        meta: 'Noble Dolphin · Waiting 12d',
        ownerName: 'James',
        ownerInitials: 'JM',
      },
    ],
    momentum: [],
    publishing: { changelog: [], helpCenter: [] },
    activity: [],
    sections: {
      support: { enabled: true, error: null },
      feedback: { enabled: true, error: null },
      changelog: { enabled: true, error: null },
      helpCenter: { enabled: true, error: null },
    },
  }
  return { overview: data }
})

vi.mock('@/lib/client/queries/admin-overview', () => ({
  adminOverviewQueries: {
    get: () => ({ queryKey: ['admin', 'overview', 'team'] }),
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({ data: overview, isLoading: false, isError: false, refetch: vi.fn() }),
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode
    className?: string
    to: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouteContext: () => ({ settings: { name: 'Acme' } }),
}))

import { OverviewDashboard } from '../admin-overview'

describe('OverviewDashboard', () => {
  it('renders compact metric copy that fits a two-up phone grid', () => {
    const { container } = render(<OverviewDashboard scope="team" onScopeChange={() => undefined} />)

    expect(screen.getByText('Waiting for reply')).toBeInTheDocument()
    expect(screen.getByText('Feedback to review')).toBeInTheDocument()
    expect(screen.getByText('No changelog')).toBeInTheDocument()
    expect(screen.getByText('Article drafts')).toBeInTheDocument()
    expect(screen.getByText('drafts')).toBeInTheDocument()

    expect(screen.queryByText('Customer waiting on a teammate')).not.toBeInTheDocument()
    expect(screen.queryByText('Complete, no changelog')).not.toBeInTheDocument()
    expect(screen.queryByText('Complete status with no linked changelog')).not.toBeInTheDocument()
    expect(screen.queryByText('Continue in Help Center')).not.toBeInTheDocument()
    expect(screen.queryByText(/On Open/)).not.toBeInTheDocument()

    const grid = container.querySelector('.grid.gap-px')
    expect(grid?.className).toContain('grid-cols-2')
    expect(grid?.className).toContain('lg:grid-cols-4')
    expect(grid?.className).not.toContain('grid-cols-3')
  })

  it('lets long attention titles wrap to two lines instead of clipping', () => {
    render(<OverviewDashboard scope="team" onScopeChange={() => undefined} />)
    const title = screen.getByText('Hello! I have just created my boards in a new cloud workspace')
    expect(title.className).toContain('line-clamp-2')
  })
})
