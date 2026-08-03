// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CustomerPeopleTable } from '../customer-people-table'

type PermissionData = {
  workspacePermissions: string[]
  teamPermissions: Array<{ permissions: string[] }>
}

type PersonRow = {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  contactId: string | null
  principalIds: string[]
  organizationName: string | null
  title: string | null
  hasPortalUser: boolean
  emailVerified: boolean
  segments: Array<{ id: string; name: string }>
  postCount: number
  commentCount: number
  voteCount: number
  ticketCount: number
  archivedAt: string | null
  kind: 'linked' | 'contact' | 'user'
}

const mocks = vi.hoisted(() => ({
  customerPeopleArgs: [] as Array<Record<string, unknown>>,
  permissionData: null as PermissionData | null,
  items: [] as PersonRow[],
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: { items: mocks.items },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    className?: string
  }) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }
    const query = search ? `?${new URLSearchParams(search).toString()}` : ''
    return <a href={`${href}${query}`}>{children}</a>
  },
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
  }: {
    children?: ReactNode
    colSpan?: number
    className?: string
  }) => <td colSpan={colSpan}>{children}</td>,
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode; className?: string }) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ src, name }: { src?: string | null; name?: string | null; className?: string }) => (
    <span>{src ? `avatar:${src}` : `avatar:${name ?? 'empty'}`}</span>
  ),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    customerPeople: (args: Record<string, unknown>) => {
      mocks.customerPeopleArgs.push(args)
      return { queryKey: ['admin', 'customer-people', args] }
    },
  },
}))

vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  useMyPermissions: () => ({
    data: mocks.permissionData,
  }),
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ORG_VIEW: 'org.view',
    TICKET_VIEW_ALL: 'ticket.view_all',
  },
}))

function person(overrides: Partial<PersonRow>): PersonRow {
  return {
    id: 'person_1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatarUrl: null,
    contactId: 'contact_1',
    principalIds: ['principal_1'],
    organizationName: 'Acme',
    title: 'Engineer',
    hasPortalUser: true,
    emailVerified: true,
    segments: [],
    postCount: 0,
    commentCount: 0,
    voteCount: 0,
    ticketCount: 0,
    archivedAt: null,
    kind: 'linked',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.customerPeopleArgs = []
  mocks.permissionData = {
    workspacePermissions: ['org.view'],
    teamPermissions: [{ permissions: ['ticket.view_all'] }],
  }
  mocks.items = [
    person({
      id: 'person_contact',
      name: 'Ada Lovelace',
      contactId: 'contact_ada',
      segments: [
        { id: 'seg_1', name: 'VIP' },
        { id: 'seg_2', name: 'Beta' },
        { id: 'seg_3', name: 'Enterprise' },
        { id: 'seg_4', name: 'EU' },
      ],
      postCount: 1_200,
      commentCount: 5,
      voteCount: 0,
      ticketCount: 1_500,
      kind: 'linked',
    }),
    person({
      id: 'person_user',
      name: null,
      email: null,
      avatarUrl: 'https://example.com/avatar.png',
      contactId: null,
      principalIds: ['principal_user'],
      organizationName: null,
      title: null,
      hasPortalUser: false,
      emailVerified: false,
      segments: [],
      postCount: 0,
      commentCount: 2,
      voteCount: 3,
      ticketCount: 0,
      archivedAt: '2026-06-01T00:00:00.000Z',
      kind: 'user',
    }),
    person({
      id: 'person_unverified',
      name: 'Unverified User',
      email: 'unverified@example.com',
      contactId: 'contact_unverified',
      hasPortalUser: true,
      emailVerified: false,
      organizationName: null,
      title: null,
      archivedAt: null,
      kind: 'contact',
    }),
  ]
})

describe('CustomerPeopleTable', () => {
  it('passes trimmed search and archived filters into the admin query', () => {
    render(<CustomerPeopleTable search="  ada  " showArchived />)

    expect(mocks.customerPeopleArgs[0]).toEqual({
      includeArchived: true,
      limit: 100,
      search: 'ada',
    })
  })

  it('renders CRM and ticket columns when permissions are present', () => {
    render(<CustomerPeopleTable search="" showArchived={false} />)

    expect(screen.getByText('Organization')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/admin/contacts/people/contact_ada'
    )
    expect(screen.getByRole('link', { name: 'person_user' })).toHaveAttribute(
      'href',
      '/admin/users?selected=principal_user'
    )
    expect(screen.getByText('avatar:https://example.com/avatar.png')).toBeInTheDocument()
    expect(screen.getByText('No email')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getAllByText('Portal user')).toHaveLength(2)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Unverified')).toBeInTheDocument()
    expect(screen.getByText('Contact only')).toBeInTheDocument()
    expect(screen.getByText('VIP')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('1.2k')).toBeInTheDocument()
    expect(screen.getByText('1.5k')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('hides CRM and ticket columns when permissions are missing', () => {
    mocks.permissionData = {
      workspacePermissions: [],
      teamPermissions: [],
    }

    render(<CustomerPeopleTable search="   " showArchived={false} />)

    expect(mocks.customerPeopleArgs[0]).toEqual({
      includeArchived: false,
      limit: 100,
    })
    expect(screen.queryByText('Organization')).not.toBeInTheDocument()
    expect(screen.queryByText('Tickets')).not.toBeInTheDocument()
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.queryByText('1.5k')).not.toBeInTheDocument()
  })

  it('renders the empty state with the correct column count when permissions are unknown', () => {
    mocks.permissionData = null
    mocks.items = []

    render(<CustomerPeopleTable search="" showArchived={false} />)

    expect(screen.getByText('No people.')).toBeInTheDocument()
    expect(screen.getByText('No people.').closest('td')).toHaveAttribute('colspan', '5')
  })
})
