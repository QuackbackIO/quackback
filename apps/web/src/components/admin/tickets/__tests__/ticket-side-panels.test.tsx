// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TicketLinkedIssues } from '../ticket-linked-issues'
import { TicketParticipantsList } from '../ticket-participants-list'
import { TicketPriorityChip, type TicketPriority } from '../ticket-priority-chip'
import { TicketQueueSidebar } from '../ticket-queue-sidebar'
import { TicketSharesPanel } from '../ticket-shares-panel'
import { TicketSlaPanel } from '../ticket-sla-panel'
import { TicketStatusPill, type StatusCategory } from '../ticket-status-pill'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  linkedIssuesQuery: {
    data: [] as Array<{
      id: string
      externalUrl: string | null
      externalDisplayId: string
      syncDirection: 'outbound' | 'inbound' | 'bidirectional'
      integrationId: string | null
    }>,
    isLoading: false,
  },
  myInboxesQuery: {
    data: [] as Array<{ id: string; name: string }>,
    isLoading: false,
  },
  slaClocks: [] as Array<{
    id: string
    kind: string
    state: string
    dueAt: string
    breachedAt?: string | null
    metAt?: string | null
  }>,
  manualSyncTicketFn: vi.fn(),
  addParticipantFn: vi.fn(),
  removeParticipantFn: vi.fn(),
  shareTicketFn: vi.fn(),
  revokeShareFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.linkedIssuesQuery,
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({ data: mocks.slaClocks }),
  useMutation: ({
    mutationFn,
    onSuccess,
    onError,
  }: {
    mutationFn: (value?: unknown) => Promise<unknown>
    onSuccess?: (value: unknown) => void
    onError?: (error: Error) => void
  }) => ({
    isPending: false,
    mutate: (value?: unknown) => {
      void mutationFn(value)
        .then((result) => onSuccess?.(result))
        .catch((error) => onError?.(error instanceof Error ? error : new Error(String(error))))
    },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode
    to: string
    search?: Record<string, unknown>
    className?: string
  }) => (
    <a
      href={`${to}?${new URLSearchParams(search as Record<string, string>).toString()}`}
      className={className}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    externalLinks: (ticketId: string) => ({ queryKey: ['tickets', 'externalLinks', ticketId] }),
    participants: (ticketId: string) => ({ queryKey: ['tickets', 'participants', ticketId] }),
    shares: (ticketId: string) => ({ queryKey: ['tickets', 'shares', ticketId] }),
    slaClocks: (ticketId: string) => ({ queryKey: ['tickets', 'slaClocks', ticketId] }),
  },
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  manualSyncTicketFn: mocks.manualSyncTicketFn,
  addParticipantFn: mocks.addParticipantFn,
  removeParticipantFn: mocks.removeParticipantFn,
  revokeShareFn: mocks.revokeShareFn,
  shareTicketFn: mocks.shareTicketFn,
}))

vi.mock('@/lib/client/hooks/use-inboxes-queries', () => ({
  useMyInboxes: () => mocks.myInboxesQuery,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    title,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    title?: string
    'aria-label'?: string
    variant?: string
    size?: string
    className?: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    value?: string
  }>({})
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children: ReactNode
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children }: { children?: ReactNode; className?: string }) => <>{children}</>,
    SelectValue: () => {
      const context = React.useContext(SelectContext)
      return <span>{context.value}</span>
    },
  }
})

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
  }) => (
    <section>
      Principal {value ?? 'none'}
      <button type="button" onClick={() => onValueChange('principal_2')}>
        Pick principal
      </button>
    </section>
  ),
}))

vi.mock('@/components/admin/shared/contact-picker', () => ({
  ContactPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
  }) => (
    <section>
      Contact {value ?? 'none'}
      <button type="button" onClick={() => onValueChange('contact_2')}>
        Pick contact
      </button>
    </section>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    placeholder?: string
  }) => (
    <section>
      Team {value ?? 'none'} {placeholder}
      <button type="button" onClick={() => onValueChange('team_2')}>
        Pick team
      </button>
    </section>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChevronDownIcon: () => <span aria-hidden="true">down</span>,
  ChevronRightIcon: () => <span aria-hidden="true">right</span>,
  GlobeAltIcon: () => <span aria-hidden="true">globe</span>,
  InboxIcon: () => <span aria-hidden="true">inbox</span>,
  QuestionMarkCircleIcon: () => <span aria-hidden="true">unknown</span>,
  ShareIcon: () => <span aria-hidden="true">share</span>,
  UserIcon: () => <span aria-hidden="true">user</span>,
  UsersIcon: () => <span aria-hidden="true">users</span>,
  XMarkIcon: () => <span aria-hidden="true">remove</span>,
}))

vi.mock('lucide-react', () => ({
  ExternalLink: () => <span aria-hidden="true">external</span>,
  GitBranch: () => <span aria-hidden="true">branch</span>,
  RefreshCw: ({ className }: { className?: string }) => <span className={className}>sync</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.linkedIssuesQuery = { data: [], isLoading: false }
  mocks.myInboxesQuery = { data: [], isLoading: false }
  mocks.slaClocks = []
  mocks.manualSyncTicketFn.mockResolvedValue({ success: true })
  mocks.addParticipantFn.mockResolvedValue(undefined)
  mocks.removeParticipantFn.mockResolvedValue(undefined)
  mocks.revokeShareFn.mockResolvedValue(undefined)
  mocks.shareTicketFn.mockResolvedValue(undefined)
  mocks.invalidateQueries.mockResolvedValue(undefined)
})

describe('TicketLinkedIssues', () => {
  it('renders linked issues, sync directions, and sync outcomes', async () => {
    mocks.linkedIssuesQuery = {
      isLoading: false,
      data: [
        {
          id: 'link_1',
          externalUrl: 'https://github.test/issues/1',
          externalDisplayId: 'GH-1',
          syncDirection: 'outbound',
          integrationId: 'integration_1',
        },
        {
          id: 'link_2',
          externalUrl: null,
          externalDisplayId: 'GH-2',
          syncDirection: 'inbound',
          integrationId: null,
        },
        {
          id: 'link_3',
          externalUrl: 'https://github.test/issues/3',
          externalDisplayId: 'GH-3',
          syncDirection: 'bidirectional',
          integrationId: 'integration_3',
        },
      ],
    }

    render(<TicketLinkedIssues ticketId={'ticket_1' as never} />)

    expect(screen.getByText('Linked Issues')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /GH-1/ })).toHaveAttribute(
      'href',
      'https://github.test/issues/1'
    )
    expect(screen.getByRole('link', { name: /GH-2/ })).toHaveAttribute('href', '#')
    expect(screen.getByText('→')).toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument()
    expect(screen.getByText('↔')).toBeInTheDocument()

    fireEvent.click(screen.getAllByTitle('Sync to GitHub')[0]!)
    await waitFor(() => {
      expect(mocks.manualSyncTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1', integrationId: 'integration_1', direction: 'push' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Sync completed')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'externalLinks', 'ticket_1'],
    })

    mocks.manualSyncTicketFn.mockResolvedValueOnce({ success: false, error: 'conflict' })
    fireEvent.click(screen.getAllByTitle('Sync to GitHub')[2]!)
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('conflict')
    })
  })

  it('renders nothing while loading, empty, or failed sync', async () => {
    const { container, rerender } = render(<TicketLinkedIssues ticketId={'ticket_1' as never} />)
    expect(container).toBeEmptyDOMElement()

    mocks.linkedIssuesQuery = { data: [], isLoading: true }
    rerender(<TicketLinkedIssues ticketId={'ticket_1' as never} />)
    expect(container).toBeEmptyDOMElement()

    mocks.linkedIssuesQuery = {
      isLoading: false,
      data: [
        {
          id: 'link_1',
          externalUrl: null,
          externalDisplayId: 'GH-1',
          syncDirection: 'outbound',
          integrationId: 'integration_1',
        },
      ],
    }
    mocks.manualSyncTicketFn.mockRejectedValueOnce(new Error('network'))
    rerender(<TicketLinkedIssues ticketId={'ticket_1' as never} />)
    fireEvent.click(screen.getByTitle('Sync to GitHub'))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Sync failed')
    })
  })
})

describe('TicketParticipantsList', () => {
  it('lists, removes, and adds principal and contact participants', async () => {
    render(
      <TicketParticipantsList
        ticketId={'ticket_1' as never}
        participants={[
          {
            id: 'participant_1' as never,
            ticketId: 'ticket_1' as never,
            principalId: 'principal_1' as never,
            contactId: null,
            role: 'watcher',
          },
          {
            id: 'participant_2' as never,
            ticketId: 'ticket_1' as never,
            principalId: null,
            contactId: 'contact_1' as never,
            role: 'cc',
          },
          {
            id: 'participant_3' as never,
            ticketId: 'ticket_1' as never,
            principalId: null,
            contactId: null,
            role: 'collaborator',
          },
        ]}
        principalNames={{ principal_1: 'Ada' }}
        contactNames={{ contact_1: 'Grace' }}
      />
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove participant' })[0]!)
    await waitFor(() => {
      expect(mocks.removeParticipantFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1', participantId: 'participant_1' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Participant removed')

    expect(screen.getByRole('button', { name: 'Add participant' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pick principal' }))
    fireEvent.click(screen.getByRole('button', { name: 'collaborator' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
    await waitFor(() => {
      expect(mocks.addParticipantFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          role: 'collaborator',
          principalId: 'principal_2',
          contactId: null,
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Participant added')

    fireEvent.click(screen.getByRole('button', { name: 'Contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'cc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
    await waitFor(() => {
      expect(mocks.addParticipantFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          role: 'cc',
          principalId: null,
          contactId: 'contact_2',
        },
      })
    })
  })

  it('shows empty participants and mutation errors', async () => {
    mocks.addParticipantFn.mockRejectedValueOnce(new Error('duplicate'))
    render(<TicketParticipantsList ticketId={'ticket_1' as never} participants={[]} />)

    expect(screen.getByText('No participants.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick principal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('duplicate')
    })
  })
})

describe('TicketPriorityChip', () => {
  it('renders all priority labels', () => {
    ;(['low', 'normal', 'high', 'urgent'] as TicketPriority[]).forEach((priority) => {
      const { unmount } = render(<TicketPriorityChip priority={priority} className="extra" />)
      expect(screen.getByText(priority)).toHaveClass('extra')
      unmount()
    })
  })
})

describe('TicketSharesPanel', () => {
  it('lists, revokes, and adds team shares when permitted', async () => {
    render(
      <TicketSharesPanel
        ticketId={'ticket_1' as never}
        shares={[
          {
            id: 'share_1' as never,
            ticketId: 'ticket_1' as never,
            teamId: 'team_1' as never,
            accessLevel: 'read',
          },
          {
            id: 'share_2' as never,
            ticketId: 'ticket_1' as never,
            teamId: 'team_unknown' as never,
            accessLevel: 'full',
          },
        ]}
        teamNames={{ team_1: 'Success' }}
        canShare
      />
    )

    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('team_unknown')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke share' })[0]!)
    await waitFor(() => {
      expect(mocks.revokeShareFn).toHaveBeenCalledWith({ data: { shareId: 'share_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Share revoked')

    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pick team' }))
    fireEvent.click(screen.getByRole('button', { name: 'full' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => {
      expect(mocks.shareTicketFn).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1', teamId: 'team_2', accessLevel: 'full' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket shared')
  })

  it('hides share controls when not permitted and reports share errors', async () => {
    const { rerender } = render(
      <TicketSharesPanel ticketId={'ticket_1' as never} shares={[]} canShare={false} />
    )
    expect(screen.getByText('Not shared with any teams.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    mocks.shareTicketFn.mockRejectedValueOnce(new Error('cannot share'))
    rerender(<TicketSharesPanel ticketId={'ticket_1' as never} shares={[]} canShare />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('cannot share')
    })
  })
})

describe('TicketSlaPanel and TicketStatusPill', () => {
  it('renders empty and populated SLA clocks', () => {
    const { rerender } = render(<TicketSlaPanel ticketId={'ticket_1' as never} />)
    expect(screen.getByText('No SLA clocks on this ticket.')).toBeInTheDocument()

    mocks.slaClocks = [
      {
        id: 'clock_1',
        kind: 'first_response',
        state: 'running',
        dueAt: '2026-06-20T12:00:00.000Z',
        breachedAt: null,
        metAt: null,
      },
      {
        id: 'clock_2',
        kind: 'custom_kind',
        state: 'paused',
        dueAt: '2026-06-20T12:00:00.000Z',
      },
    ]
    rerender(<TicketSlaPanel ticketId={'ticket_1' as never} />)
    expect(screen.getByText('First response')).toBeInTheDocument()
    expect(screen.getByText('custom_kind')).toBeInTheDocument()
  })

  it('renders all status category pills', () => {
    ;(['open', 'pending', 'on_hold', 'solved', 'closed'] as StatusCategory[]).forEach(
      (category) => {
        const { unmount } = render(
          <TicketStatusPill name={`Status ${category}`} category={category} className="extra" />
        )
        expect(screen.getByText(`Status ${category}`)).toHaveClass('extra')
        unmount()
      }
    )
  })
})

describe('TicketQueueSidebar', () => {
  it('renders saved views, inbox links, and collapse behavior', () => {
    mocks.myInboxesQuery = {
      isLoading: false,
      data: [
        { id: 'inbox_1', name: 'Support' },
        { id: 'inbox_2', name: 'Billing' },
      ],
    }

    render(<TicketQueueSidebar activeScope="inbox" activeInboxId="inbox_2" />)

    expect(screen.getByRole('link', { name: /Assigned to me/ })).toHaveAttribute(
      'href',
      expect.stringContaining('scope=my_assigned')
    )
    expect(screen.getByRole('link', { name: /All/ })).toHaveAttribute(
      'href',
      expect.stringContaining('scope=all')
    )
    expect(screen.getByRole('link', { name: /Billing/ })).toHaveAttribute(
      'href',
      expect.stringContaining('inboxId=inbox_2')
    )

    fireEvent.click(screen.getByRole('button', { name: /By inbox/ }))
    expect(screen.queryByRole('link', { name: /Support/ })).not.toBeInTheDocument()
  })

  it('renders loading and empty inbox states', () => {
    mocks.myInboxesQuery = { data: [], isLoading: true }
    const { rerender } = render(<TicketQueueSidebar activeScope="all" />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()

    mocks.myInboxesQuery = { data: [], isLoading: false }
    rerender(<TicketQueueSidebar activeScope="my_team" />)
    expect(screen.getByText('No inboxes')).toBeInTheDocument()
  })
})
