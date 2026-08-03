// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InboxList } from '../inbox-list'

type InboxRow = {
  id: string
  name: string
  slug: string
  color: string | null
  defaultPriority: string
  defaultVisibilityScope: string
  archivedAt: string | null
}

const mocks = vi.hoisted(() => ({
  inboxes: [] as InboxRow[],
  listParams: undefined as unknown,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: mocks.inboxes,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children: ReactNode
    params?: Record<string, string>
    to: string
    className?: string
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to
    )
    return <a href={href}>{children}</a>
  },
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    list: (params: unknown) => {
      mocks.listParams = params
      return { queryKey: ['inboxes', 'list', params] }
    },
  },
}))

function inbox(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 'inbox_support',
    name: 'Support',
    slug: 'support',
    color: '#22c55e',
    defaultPriority: 'normal',
    defaultVisibilityScope: 'team',
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.inboxes = []
  mocks.listParams = undefined
})

describe('InboxList', () => {
  it('renders active inboxes by default and reveals archived rows through the toggle', () => {
    mocks.inboxes = [
      inbox(),
      inbox({
        id: 'inbox_archived',
        name: 'Archived',
        slug: 'archived',
        color: null,
        defaultPriority: 'urgent',
        defaultVisibilityScope: 'private',
        archivedAt: '2026-06-20T10:00:00.000Z',
      }),
    ]

    render(<InboxList />)

    expect(mocks.listParams).toEqual({ includeArchived: true })
    expect(screen.getByRole('link', { name: /Support/ })).toHaveAttribute(
      'href',
      '/admin/settings/inboxes/inbox_support'
    )
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(screen.getByText('normal · team')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Archived/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show archived'))

    expect(screen.getByRole('link', { name: /Archived/ })).toHaveAttribute(
      'href',
      '/admin/settings/inboxes/inbox_archived'
    )
    expect(screen.getByText('urgent · private')).toBeInTheDocument()
    expect(screen.getAllByText('Archived')).toHaveLength(2)
  })

  it('renders an empty state when there are no visible inboxes', () => {
    render(<InboxList />)

    expect(screen.getByText('No inboxes yet.')).toBeInTheDocument()
  })
})
