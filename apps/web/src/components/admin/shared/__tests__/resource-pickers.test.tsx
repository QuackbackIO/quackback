// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContactPicker } from '../contact-picker'
import { InboxPicker } from '../inbox-picker'
import { OrgPicker } from '../org-picker'
import { PermissionGate } from '../permission-gate'
import { ResourcePicker } from '../resource-picker'
import { StatusPicker } from '../status-picker'
import { TeamPicker } from '../team-picker'

const mocks = vi.hoisted(() => ({
  contactSearchCalls: [] as Array<[string, boolean]>,
  organizationCalls: [] as Array<{ query?: string }>,
  inboxCalls: [] as Array<{ includeArchived?: boolean }>,
  teamCalls: [] as Array<{ includeArchived?: boolean }>,
  hasPermission: true,
}))

vi.mock('@/lib/client/hooks/use-orgs-contacts-queries', () => ({
  useContactSearch: (query: string, enabled: boolean) => {
    mocks.contactSearchCalls.push([query, enabled])
    return {
      isLoading: query === 'loading',
      data:
        query === 'empty'
          ? []
          : [
              { id: 'contact_1', name: 'Ada Lovelace', email: 'ada@example.com' },
              { id: 'contact_2', name: null, email: 'contact@example.com' },
            ],
    }
  },
  useOrganizations: (params: { query?: string }) => {
    mocks.organizationCalls.push(params)
    return {
      isLoading: params.query === 'loading',
      data:
        params.query === 'empty'
          ? []
          : [
              { id: 'org_1', name: 'Acme', domain: 'acme.com' },
              { id: 'org_2', name: 'Globex', domain: null },
            ],
    }
  },
}))

vi.mock('@/lib/client/hooks/use-inboxes-queries', () => ({
  useInboxes: (params: { includeArchived?: boolean }) => {
    mocks.inboxCalls.push(params)
    return {
      isLoading: false,
      data: [
        { id: 'inbox_1', name: 'Support', slug: 'support' },
        { id: 'inbox_2', name: 'Billing', slug: 'billing' },
      ],
    }
  },
}))

vi.mock('@/lib/client/hooks/use-teams-queries', () => ({
  useTeams: (params: { includeArchived?: boolean }) => {
    mocks.teamCalls.push(params)
    return {
      isLoading: false,
      data: [
        { id: 'team_1', name: 'Success', slug: 'success', color: '#22c55e', shortLabel: 'CS' },
        { id: 'team_2', name: 'Sales', slug: 'sales', color: null, shortLabel: null },
      ],
    }
  },
}))

vi.mock('@/lib/client/hooks/use-tickets-queries', () => ({
  useTicketStatuses: () => ({
    isLoading: false,
    data: [
      { id: 'status_1', name: 'Open', category: 'open', color: '#22c55e' },
      { id: 'status_2', name: 'Closed', category: 'closed', color: null },
    ],
  }),
}))

vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  useHasPermission: vi.fn((_permission, _params) => mocks.hasPermission),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    role,
    'aria-expanded': ariaExpanded,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    role?: string
    'aria-expanded'?: boolean
    variant?: string
    className?: string
  }) => (
    <button
      type="button"
      role={role}
      aria-expanded={ariaExpanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  })
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open: boolean
      onOpenChange: (open: boolean) => void
    }) => (
      <PopoverContext.Provider value={{ open, setOpen: onOpenChange }}>
        <div>{children}</div>
      </PopoverContext.Provider>
    ),
    PopoverContent: ({ children }: { children: ReactNode; className?: string; align?: string }) => {
      const context = React.useContext(PopoverContext)
      return context.open ? <section>{children}</section> : null
    },
    PopoverTrigger: ({ children }: { children: React.ReactElement; asChild?: boolean }) => {
      const context = React.useContext(PopoverContext)
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => context.setOpen(true),
      })
    },
  }
})

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode; shouldFilter?: boolean }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    placeholder,
    value,
    onValueChange,
  }: {
    placeholder?: string
    value: string
    onValueChange: (value: string) => void
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
    value,
  }: {
    children: ReactNode
    onSelect?: () => void
    value?: string
    className?: string
  }) => (
    <button type="button" data-value={value} onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  CheckIcon: ({ className }: { className?: string }) => <span className={className}>check</span>,
  ChevronUpDownIcon: () => <span aria-hidden="true">chevron</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.contactSearchCalls = []
  mocks.organizationCalls = []
  mocks.inboxCalls = []
  mocks.teamCalls = []
  mocks.hasPermission = true
})

describe('ResourcePicker', () => {
  it('selects, clears, searches, and renders labels for single values', () => {
    const onValueChange = vi.fn()
    const onSearchChange = vi.fn()
    const { rerender } = render(
      <ResourcePicker
        value={null}
        onValueChange={onValueChange}
        options={[
          { id: 'alpha', label: 'Alpha', description: 'First', trailing: <span>new</span> },
          { id: 'beta', label: 'Beta', leading: <span>avatar</span> },
        ]}
        placeholder="Pick one"
        searchPlaceholder="Search resources"
        emptyMessage="Nothing here"
        allowClear
        clearLabel="No resource"
        onSearchChange={onSearchChange}
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('Pick one')
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('No resource')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search resources'), {
      target: { value: 'be' },
    })
    expect(onSearchChange).toHaveBeenCalledWith('be')
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
    expect(onValueChange).toHaveBeenCalledWith('beta')

    rerender(
      <ResourcePicker
        value="alpha"
        onValueChange={onValueChange}
        options={[{ id: 'alpha', label: 'Alpha', description: 'First' }]}
        allowClear
      />
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('Alpha')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })

  it('toggles multiple values and reports loading empty state', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <ResourcePicker
        multiple
        value={['alpha', 'missing']}
        onValueChange={onValueChange}
        options={[
          { id: 'alpha', label: 'Alpha' },
          { id: 'beta', label: 'Beta' },
        ]}
        placeholder="Pick many"
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('2 selected')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(onValueChange).toHaveBeenCalledWith(['missing'])
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
    expect(onValueChange).toHaveBeenCalledWith(['alpha', 'missing', 'beta'])

    rerender(
      <ResourcePicker
        multiple
        value={[]}
        onValueChange={onValueChange}
        options={[]}
        isLoading
        emptyMessage="No values"
      />
    )
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })
})

describe('picker wrappers', () => {
  it('maps contacts, organizations, and inboxes into resource options', () => {
    const onContactChange = vi.fn()
    const onOrgChange = vi.fn()
    const onInboxChange = vi.fn()
    const onInboxMultiChange = vi.fn()
    const onTeamChange = vi.fn()
    const onTeamMultiChange = vi.fn()
    const onStatusChange = vi.fn()

    render(
      <>
        <ContactPicker value={null} onValueChange={onContactChange} allowClear />
        <OrgPicker value={null} onValueChange={onOrgChange} allowClear />
        <InboxPicker value={null} onValueChange={onInboxChange} includeArchived allowClear />
        <InboxPicker multiple value={['inbox_1' as never]} onValueChange={onInboxMultiChange} />
        <TeamPicker value={null} onValueChange={onTeamChange} includeArchived allowClear />
        <TeamPicker multiple value={['team_1' as never]} onValueChange={onTeamMultiChange} />
        <StatusPicker value={null} onValueChange={onStatusChange} />
      </>
    )

    fireEvent.click(screen.getAllByRole('combobox')[0]!)
    fireEvent.change(screen.getByPlaceholderText(/Search by name or email/), {
      target: { value: 'ada' },
    })
    expect(mocks.contactSearchCalls.at(-1)).toEqual(['ada', true])
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    expect(onContactChange).toHaveBeenCalledWith('contact_1')

    fireEvent.click(screen.getAllByRole('combobox')[1]!)
    fireEvent.change(screen.getByPlaceholderText(/Search organizations/), {
      target: { value: 'acme' },
    })
    expect(mocks.organizationCalls.at(-1)).toEqual({ query: 'acme' })
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    expect(onOrgChange).toHaveBeenCalledWith('org_1')

    fireEvent.click(screen.getAllByRole('combobox')[2]!)
    expect(mocks.inboxCalls[0]).toEqual({ includeArchived: true })
    fireEvent.click(screen.getByRole('button', { name: /Support/ }))
    expect(onInboxChange).toHaveBeenCalledWith('inbox_1')

    fireEvent.click(screen.getAllByRole('combobox')[3]!)
    fireEvent.click(screen.getAllByRole('button', { name: /Billing/ }).at(-1)!)
    expect(onInboxMultiChange).toHaveBeenCalledWith(['inbox_1', 'inbox_2'])

    fireEvent.click(screen.getAllByRole('combobox')[4]!)
    expect(mocks.teamCalls[0]).toEqual({ includeArchived: true })
    fireEvent.click(screen.getAllByRole('button', { name: /Success/ }).at(-1)!)
    expect(onTeamChange).toHaveBeenCalledWith('team_1')

    fireEvent.click(screen.getAllByRole('combobox')[5]!)
    fireEvent.click(screen.getAllByRole('button', { name: /Sales/ }).at(-1)!)
    expect(onTeamMultiChange).toHaveBeenCalledWith(['team_1', 'team_2'])

    fireEvent.click(screen.getAllByRole('combobox')[6]!)
    fireEvent.click(screen.getAllByRole('button', { name: /Closed/ }).at(-1)!)
    expect(onStatusChange).toHaveBeenCalledWith('status_2')
  })

  it('renders wrapper empty and loading messages', () => {
    const { rerender } = render(<ContactPicker value={null} onValueChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText(/Type to search/)).toBeInTheDocument()

    rerender(<OrgPicker value={null} onValueChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByPlaceholderText(/Search organizations/), {
      target: { value: 'empty' },
    })
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })
})

describe('PermissionGate', () => {
  it('renders children or fallback from permission state', () => {
    const { rerender } = render(
      <PermissionGate
        permission="ticket.view_all"
        teamId={'team_1' as never}
        fallback={<span>Denied</span>}
      >
        <span>Allowed</span>
      </PermissionGate>
    )

    expect(screen.getByText('Allowed')).toBeInTheDocument()

    mocks.hasPermission = false
    rerender(
      <PermissionGate permission="ticket.view_all" loadingFallback fallback={<span>Denied</span>}>
        <span>Allowed</span>
      </PermissionGate>
    )

    expect(screen.getByText('Denied')).toBeInTheDocument()
  })
})
