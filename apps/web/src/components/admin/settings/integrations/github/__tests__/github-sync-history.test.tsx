// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GitHubSyncHistory } from '../github-sync-history'

type SyncEntry = {
  id: string
  status: 'success' | 'failed' | 'skipped'
  direction: 'outbound' | 'inbound'
  eventType: string
  ticketSubject?: string | null
  errorMessage?: string | null
  durationMs?: number | null
  createdAt: string
}

type QueryState = {
  data?: { items: SyncEntry[] }
  error?: Error
  isError?: boolean
  isLoading?: boolean
}

const mocks = vi.hoisted(() => ({
  fetchSyncLogFn: vi.fn(),
  states: {
    all: {} as QueryState,
    failed: {} as QueryState,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey?: readonly unknown[]; queryFn?: () => unknown }) => {
    options.queryFn?.()
    const statusFilter = options.queryKey?.[2] === 'failed' ? 'failed' : 'all'
    const state = mocks.states[statusFilter]
    return {
      data: state.data,
      error: state.error ?? new Error('No error'),
      isError: state.isError ?? false,
      isLoading: state.isLoading ?? false,
    }
  },
}))

vi.mock('@/lib/server/functions/integrations', () => ({
  fetchSyncLogFn: mocks.fetchSyncLogFn,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, className }: { children: ReactNode; className?: string }) => (
    <label className={className}>{children}</label>
  ),
}))

function entry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    id: 'sync_1',
    status: 'success',
    direction: 'outbound',
    eventType: 'ticket.created',
    ticketSubject: 'Broken checkout',
    errorMessage: null,
    durationMs: 42,
    createdAt: '2026-06-20T10:59:30.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-20T11:00:00.000Z'))
  mocks.fetchSyncLogFn.mockResolvedValue({ items: [] })
  mocks.states.all = {
    data: {
      items: [
        entry(),
        entry({
          id: 'sync_2',
          status: 'failed',
          direction: 'inbound',
          eventType: 'issue.updated',
          ticketSubject: null,
          errorMessage: 'GitHub API rejected the update',
          durationMs: null,
          createdAt: '2026-06-20T10:50:00.000Z',
        }),
        entry({
          id: 'sync_3',
          status: 'skipped',
          direction: 'outbound',
          eventType: 'ticket.closed',
          ticketSubject: 'Old ticket',
          createdAt: '2026-06-20T08:00:00.000Z',
        }),
      ],
    },
  }
  mocks.states.failed = {
    data: {
      items: [
        entry({
          id: 'sync_2',
          status: 'failed',
          direction: 'inbound',
          eventType: 'issue.updated',
          ticketSubject: null,
          errorMessage: 'GitHub API rejected the update',
          durationMs: null,
          createdAt: '2026-06-18T11:00:00.000Z',
        }),
      ],
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GitHubSyncHistory', () => {
  it('renders sync entries and refetches with the failed filter', () => {
    render(<GitHubSyncHistory integrationId="github_1" />)

    expect(screen.getByText('Sync History')).toBeInTheDocument()
    expect(screen.getByText('Recent sync operations')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('skipped')).toBeInTheDocument()
    expect(screen.getByText(/ticket.created/)).toHaveTextContent('Broken checkout')
    expect(screen.getByText('GitHub API rejected the update')).toHaveAttribute(
      'title',
      'GitHub API rejected the update'
    )
    expect(screen.getByText('42ms · just now')).toBeInTheDocument()
    expect(screen.getByText('10m ago')).toBeInTheDocument()
    expect(screen.getByText(/3h ago/)).toBeInTheDocument()

    expect(mocks.fetchSyncLogFn).toHaveBeenCalledWith({
      data: { integrationId: 'github_1', limit: 25, statusFilter: 'all' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))

    expect(mocks.fetchSyncLogFn).toHaveBeenCalledWith({
      data: { integrationId: 'github_1', limit: 25, statusFilter: 'failed' },
    })
    expect(screen.getByText('2d ago')).toBeInTheDocument()
  })

  it('renders loading, empty, and error states', () => {
    mocks.states.all = { isLoading: true }
    const { rerender } = render(<GitHubSyncHistory integrationId="github_1" />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()

    mocks.states.all = { data: { items: [] } }
    rerender(<GitHubSyncHistory integrationId="github_1" />)
    expect(screen.getByText('No sync activity yet')).toBeInTheDocument()

    mocks.states.all = {
      isError: true,
      error: new Error('Sync log unavailable'),
    }
    rerender(<GitHubSyncHistory integrationId="github_1" />)
    expect(screen.getByText('Failed to load sync history')).toHaveAttribute(
      'title',
      'Sync log unavailable'
    )
  })
})
