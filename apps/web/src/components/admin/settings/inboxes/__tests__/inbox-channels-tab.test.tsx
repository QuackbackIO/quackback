// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InboxChannelsTab } from '../inbox-channels-tab'

type Channel = {
  id: string
  kind: string
  label: string
  externalId: string | null
  enabled: boolean
  archivedAt: string | null
}

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateInboxChannelFn: vi.fn(),
  archiveInboxChannelFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
  channels: [] as Channel[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: mocks.channels,
  }),
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: false,
    mutate: async (vars: TVars) => {
      try {
        const result = await options.mutationFn(vars)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({
    children,
    fallback = null,
  }: {
    children: ReactNode
    fallback?: ReactNode
    permission: string
  }) => (mocks.permissionAllowed ? <>{children}</> : <>{fallback}</>),
}))

vi.mock('../inbox-channel-dialog', () => ({
  InboxChannelDialog: ({
    trigger,
    channel,
  }: {
    inboxId: string
    trigger: ReactNode
    channel?: Channel
  }) => (
    <div>
      {trigger}
      <span>{channel ? `Edit dialog for ${channel.label}` : 'Add channel dialog'}</span>
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={() => onCheckedChange(!checked)}
    />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
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
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  PencilSquareIcon: () => <span aria-hidden="true">pencil</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    channels: (inboxId: string) => ({ queryKey: ['inboxes', inboxId, 'channels'] }),
  },
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  updateInboxChannelFn: mocks.updateInboxChannelFn,
  archiveInboxChannelFn: mocks.archiveInboxChannelFn,
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    INBOX_CHANNEL_MANAGE: 'inbox_channel.manage',
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.channels = [
    {
      id: 'channel_portal',
      kind: 'portal',
      label: 'Portal',
      externalId: null,
      enabled: true,
      archivedAt: null,
    },
    {
      id: 'channel_email',
      kind: 'email',
      label: 'Support email',
      externalId: 'mailbox_1',
      enabled: false,
      archivedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'channel_custom',
      kind: 'custom',
      label: 'Custom channel',
      externalId: 'custom_1',
      enabled: true,
      archivedAt: null,
    },
  ]
  mocks.updateInboxChannelFn.mockResolvedValue({ id: 'channel_portal' })
  mocks.archiveInboxChannelFn.mockResolvedValue(undefined)
})

describe('InboxChannelsTab', () => {
  it('renders empty state and add-channel affordance', () => {
    mocks.channels = []
    render(<InboxChannelsTab inboxId={'inbox_1' as never} />)

    expect(screen.getByText('No channels yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add channel' })).toBeInTheDocument()
    expect(screen.getByText('Add channel dialog')).toBeInTheDocument()
  })

  it('renders channel rows with status, external id fallbacks and edit affordances', () => {
    render(<InboxChannelsTab inboxId={'inbox_1' as never} />)

    expect(screen.getByText('portal')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('custom')).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.getByText('Support email')).toBeInTheDocument()
    expect(screen.getByText('mailbox_1')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getAllByText('Active')).toHaveLength(2)
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText('Edit dialog for Portal')).toBeInTheDocument()
  })

  it('toggles and archives active channels with cache invalidation', async () => {
    render(<InboxChannelsTab inboxId={'inbox_1' as never} />)

    fireEvent.click(screen.getAllByLabelText('Toggle channel enabled')[0])
    await waitFor(() => {
      expect(mocks.updateInboxChannelFn).toHaveBeenCalledWith({
        data: { channelId: 'channel_portal', enabled: false },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'inbox_1', 'channels'],
    })

    expect(screen.getAllByLabelText('Toggle channel enabled')[1]).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    await waitFor(() => {
      expect(mocks.archiveInboxChannelFn).toHaveBeenCalledWith({
        data: { channelId: 'channel_portal' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Channel archived')
  })

  it('reports mutation errors and renders permission-denied fallback states', async () => {
    mocks.updateInboxChannelFn.mockRejectedValueOnce(new Error('Toggle denied'))
    mocks.archiveInboxChannelFn.mockRejectedValueOnce(new Error('Archive denied'))
    render(<InboxChannelsTab inboxId={'inbox_1' as never} />)

    fireEvent.click(screen.getAllByLabelText('Toggle channel enabled')[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Toggle denied')
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Archive denied')
    })

    cleanup()
    mocks.permissionAllowed = false
    render(<InboxChannelsTab inboxId={'inbox_1' as never} />)

    expect(screen.queryByRole('button', { name: 'Add channel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit channel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive channel' })).not.toBeInTheDocument()
    expect(screen.getAllByText('on')).toHaveLength(2)
    expect(screen.getByText('off')).toBeInTheDocument()
  })
})
