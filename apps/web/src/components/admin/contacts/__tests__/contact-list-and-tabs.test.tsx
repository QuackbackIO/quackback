// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContactList } from '../contact-list'
import { ContactTicketsTab } from '../contact-tickets-tab'
import { OrganizationList } from '../organization-list'
import { OrganizationContactsTab } from '../organization-contacts-tab'
import { OrganizationTicketsTab } from '../organization-tickets-tab'

type ContactRow = {
  id: string
  name: string | null
  email: string | null
  phone?: string | null
  title: string | null
  organizationId: string | null
  archivedAt: string | null
}

type TicketRow = {
  id: string
  subject: string
  priority: string
  channel: string
  lastActivityAt: string | null
}

type OrganizationRow = {
  id: string
  name: string
  domain: string | null
  website: string | null
  externalId: string | null
  archivedAt: string | null
}

const mocks = vi.hoisted(() => ({
  searchContacts: [] as ContactRow[],
  orgContacts: [] as ContactRow[],
  organizations: [] as Array<{ id: string; name: string }>,
  organizationList: [] as OrganizationRow[],
  organizationListParams: undefined as unknown,
  ticketRows: [] as TicketRow[],
  listTicketsFn: vi.fn(),
  permissionAllowed: true,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (options: { queryKey?: unknown[]; queryFn?: () => { rows: TicketRow[] } }) => {
    if (options.queryFn) return { data: options.queryFn() }
    if (options.queryKey?.[1] === 'byOrg') return { data: mocks.orgContacts }
    if (options.queryKey?.[0] === 'organizations') return { data: mocks.organizationList }
    return { data: mocks.searchContacts }
  },
  useQuery: () => ({
    data: mocks.organizations,
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
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to
    )
    return <a href={href}>{children}</a>
  },
}))

vi.mock('@/lib/client/queries/contacts', () => ({
  contactQueries: {
    search: (params: unknown) => ({ queryKey: ['contacts', 'search', params] }),
    byOrg: (organizationId: string, params: unknown) => ({
      queryKey: ['contacts', 'byOrg', organizationId, params],
    }),
  },
}))

vi.mock('@/lib/client/queries/organizations', () => ({
  organizationQueries: {
    list: (params: unknown) => {
      mocks.organizationListParams = params
      return { queryKey: ['organizations', 'list', params] }
    },
  },
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  listTicketsFn: mocks.listTicketsFn,
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: { children: ReactNode; permission: string }) =>
    mocks.permissionAllowed ? <>{children}</> : null,
}))

vi.mock('@/components/admin/contacts/contact-create-dialog', () => ({
  ContactCreateDialog: ({
    defaultOrganizationId,
    trigger,
  }: {
    defaultOrganizationId: string
    trigger: ReactNode
  }) => <div data-default-organization-id={defaultOrganizationId}>{trigger}</div>,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ORG_MANAGE: 'org.manage',
  },
}))

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 'contact_1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 1000',
    title: 'Engineer',
    organizationId: 'org_acme',
    archivedAt: null,
    ...overrides,
  }
}

function organization(overrides: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: 'org_acme',
    name: 'Acme',
    domain: 'acme.com',
    website: 'https://acme.com',
    externalId: 'crm-acme',
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchContacts = []
  mocks.orgContacts = []
  mocks.organizations = []
  mocks.organizationList = []
  mocks.organizationListParams = undefined
  mocks.ticketRows = []
  mocks.permissionAllowed = true
  mocks.listTicketsFn.mockImplementation(() => ({ rows: mocks.ticketRows }))
})

describe('ContactList', () => {
  it('renders search rows with organization names, fallbacks and status badges', () => {
    mocks.searchContacts = [
      contact(),
      contact({
        id: 'contact_email',
        name: null,
        email: 'fallback@example.com',
        organizationId: 'org_unknown',
        title: null,
        archivedAt: '2026-06-20T10:00:00.000Z',
      }),
      contact({
        id: 'contact_id',
        name: null,
        email: null,
        organizationId: null,
      }),
    ]
    mocks.organizations = [{ id: 'org_acme', name: 'Acme' }]

    render(<ContactList search="ada" showArchived />)

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/admin/contacts/people/contact_1'
    )
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('org_unknown')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'fallback@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'contact_id' })).toBeInTheDocument()
    expect(screen.getAllByText('Active')).toHaveLength(2)
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('renders an empty contact-list row', () => {
    render(<ContactList search="" showArchived={false} />)

    expect(screen.getByText('No contacts.')).toBeInTheDocument()
  })
})

describe('ContactTicketsTab', () => {
  it('requests tickets for the contact and renders ticket rows', () => {
    mocks.ticketRows = [
      {
        id: 'ticket_1',
        subject: 'Cannot sign in',
        priority: 'urgent',
        channel: 'portal',
        lastActivityAt: '2026-06-20T10:00:00.000Z',
      },
      {
        id: 'ticket_2',
        subject: 'Billing question',
        priority: 'normal',
        channel: 'email',
        lastActivityAt: null,
      },
    ]

    render(<ContactTicketsTab contactId={'contact_1' as never} />)

    expect(mocks.listTicketsFn).toHaveBeenCalledWith({
      data: { scope: 'all', requesterContactId: 'contact_1', limit: 100 },
    })
    expect(screen.getByRole('link', { name: 'Cannot sign in' })).toHaveAttribute(
      'href',
      '/admin/tickets/ticket_1'
    )
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(screen.getByText('portal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Billing question' })).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
  })

  it('renders an empty ticket row', () => {
    render(<ContactTicketsTab contactId={'contact_1' as never} />)

    expect(screen.getByText('No tickets for this contact.')).toBeInTheDocument()
  })
})

describe('OrganizationContactsTab', () => {
  it('renders organization contacts and passes the organization id to the create dialog', () => {
    mocks.orgContacts = [
      contact(),
      contact({
        id: 'contact_archived',
        name: null,
        email: null,
        phone: null,
        title: null,
        organizationId: 'org_acme',
        archivedAt: '2026-06-20T10:00:00.000Z',
      }),
    ]

    const { container } = render(<OrganizationContactsTab organizationId={'org_acme' as never} />)

    expect(screen.getByRole('button', { name: /Add contact/ })).toBeInTheDocument()
    expect(container.querySelector('[data-default-organization-id="org_acme"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/admin/contacts/people/contact_1'
    )
    expect(screen.getByRole('link', { name: 'contact_archived' })).toBeInTheDocument()
    expect(screen.getByText('+1 555 1000')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('hides the add-contact action when the actor lacks org management permission', () => {
    mocks.permissionAllowed = false

    render(<OrganizationContactsTab organizationId={'org_acme' as never} />)

    expect(screen.queryByRole('button', { name: /Add contact/ })).not.toBeInTheDocument()
    expect(screen.getByText('No contacts in this organization yet.')).toBeInTheDocument()
  })
})

describe('OrganizationList', () => {
  it('trims search, filters archived rows and renders organization fallbacks', () => {
    mocks.organizationList = [
      organization(),
      organization({
        id: 'org_archived',
        name: 'Archived org',
        domain: null,
        website: null,
        externalId: null,
        archivedAt: '2026-06-20T10:00:00.000Z',
      }),
    ]

    const { rerender } = render(<OrganizationList search="  acme  " showArchived={false} />)

    expect(mocks.organizationListParams).toEqual({
      includeArchived: true,
      search: 'acme',
    })
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/admin/contacts/organizations/org_acme'
    )
    expect(screen.getByText('acme.com')).toBeInTheDocument()
    expect(screen.getByText('https://acme.com')).toBeInTheDocument()
    expect(screen.getByText('crm-acme')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Archived org' })).not.toBeInTheDocument()

    rerender(<OrganizationList search="" showArchived />)

    expect(mocks.organizationListParams).toEqual({ includeArchived: true })
    expect(screen.getByRole('link', { name: 'Archived org' })).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('renders an empty organization-list row', () => {
    render(<OrganizationList search="" showArchived={false} />)

    expect(screen.getByText('No organizations.')).toBeInTheDocument()
  })
})

describe('OrganizationTicketsTab', () => {
  it('requests tickets for the organization and renders ticket rows', () => {
    mocks.ticketRows = [
      {
        id: 'ticket_1',
        subject: 'SLA escalation',
        priority: 'high',
        channel: 'email',
        lastActivityAt: '2026-06-20T10:00:00.000Z',
      },
    ]

    render(<OrganizationTicketsTab organizationId={'org_acme' as never} />)

    expect(mocks.listTicketsFn).toHaveBeenCalledWith({
      data: { scope: 'all', organizationId: 'org_acme', limit: 100 },
    })
    expect(screen.getByRole('link', { name: 'SLA escalation' })).toHaveAttribute(
      'href',
      '/admin/tickets/ticket_1'
    )
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
  })

  it('renders an empty organization-ticket row', () => {
    render(<OrganizationTicketsTab organizationId={'org_acme' as never} />)

    expect(screen.getByText('No tickets for this organization.')).toBeInTheDocument()
  })
})
