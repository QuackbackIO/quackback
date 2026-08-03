// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalAuthTab } from '../portal-auth-tab'

const mocks = vi.hoisted(() => ({
  routerInvalidate: vi.fn(),
  updatePortalAccessFn: vi.fn(),
  query: {
    data: [
      { id: 'segment_1', name: 'Enterprise' },
      { id: 'segment_2', name: 'Trial' },
    ],
    isLoading: false,
    isError: false,
  } as {
    data?: Array<{ id: string; name: string }>
    isLoading: boolean
    isError: boolean
  },
  openInviteDialog: vi.fn(),
  inviteOpenChange: vi.fn(),
  sendInvites: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
  }: {
    children: ReactNode
    to: string
    search?: Record<string, unknown>
    className?: string
  }) => <a href={to}>{children}</a>,
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.query,
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  updatePortalAccessFn: mocks.updatePortalAccessFn,
}))

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn(),
}))

vi.mock('@/components/admin/settings/settings-card', () => ({
  SettingsCard: ({
    title,
    description,
    action,
    children,
  }: {
    title: string
    description: string
    action?: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
      {children}
    </section>
  ),
}))

vi.mock('@/components/admin/settings/portal-privacy-dialog', () => ({
  PortalPrivacyDialog: ({
    open,
    onOpenChange,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
  }) =>
    open ? (
      <section role="alertdialog">
        <span>Private portal confirmation</span>
        <button type="button" onClick={onConfirm}>
          Confirm private
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel private
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/admin/users/use-portal-invites', () => ({
  usePortalInvites: () => ({
    invites: [
      { id: 'invite_1', status: 'pending' },
      { id: 'invite_2', status: 'accepted' },
    ],
    pendingCount: 1,
    acceptedCount: 1,
    isLoading: false,
    lastSentSummary: 'Sent 2 invites',
    dialogOpen: true,
    emailsInput: 'ada@example.com',
    messageInput: 'hello',
    emailError: null,
    batchResults: [],
    sendBusy: false,
    openDialog: mocks.openInviteDialog,
    onOpenChange: mocks.inviteOpenChange,
    onEmailsChange: vi.fn(),
    onMessageChange: vi.fn(),
    onSend: mocks.sendInvites,
  }),
}))

vi.mock('@/components/admin/users/invite-people-dialog', () => ({
  InvitePeopleDialog: ({
    open,
    emailsInput,
    onOpenChange,
    onSend,
  }: {
    open: boolean
    emailsInput: string
    onOpenChange: (open: boolean) => void
    onSend: () => void
    [key: string]: unknown
  }) =>
    open ? (
      <section>
        Invite dialog {emailsInput}
        <button type="button" onClick={onSend}>
          Send invites
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close invites
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/admin/segments/segment-multi-select', () => ({
  SegmentMultiSelect: ({
    segments,
    value,
    onChange,
    disabled,
  }: {
    segments: Array<{ id: string; name: string }>
    value: string[]
    onChange: (value: string[]) => void
    disabled?: boolean
  }) => (
    <section>
      <span>
        Segment picker {segments.map((segment) => segment.name).join(', ')} selected{' '}
        {value.join(', ') || 'none'}
      </span>
      <button type="button" disabled={disabled} onClick={() => onChange(['segment_2'])}>
        Pick trial segment
      </button>
    </section>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = 'button',
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void
    placeholder?: string
    disabled?: boolean
    'aria-label'?: string
    'aria-invalid'?: boolean
    className?: string
  }) => (
    <input
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
      onKeyDown={(event) =>
        onKeyDown?.({ key: event.key, preventDefault: () => event.preventDefault() })
      }
    />
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    id?: string
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">refresh</span>,
  ArrowRightIcon: () => <span aria-hidden="true">right</span>,
  GlobeAltIcon: () => <span aria-hidden="true">globe</span>,
  LockClosedIcon: () => <span aria-hidden="true">lock</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  XMarkIcon: () => <span aria-hidden="true">remove</span>,
}))

function privateConfig(overrides: Record<string, unknown> = {}) {
  return {
    access: {
      visibility: 'private',
      allowedDomains: ['acme.com'],
      widgetSignIn: true,
      allowedSegmentIds: ['segment_1'],
      ...overrides,
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query = {
    data: [
      { id: 'segment_1', name: 'Enterprise' },
      { id: 'segment_2', name: 'Trial' },
    ],
    isLoading: false,
    isError: false,
  }
  mocks.updatePortalAccessFn.mockResolvedValue(undefined)
})

describe('PortalAuthTab', () => {
  it('updates private portal domains, segments, widget sign-in, and invite actions', async () => {
    render(<PortalAuthTab portalConfig={privateConfig()} />)

    expect(screen.getByText('Your team always has access.')).toBeInTheDocument()
    expect(screen.getByText('acme.com')).toBeInTheDocument()
    expect(
      screen.getByText(/Segment picker Enterprise, Trial selected segment_1/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('Members of 1 selected segment can access this portal.')
    ).toBeInTheDocument()
    expect(screen.getByText('1 pending · 1 accepted')).toBeInTheDocument()
    expect(screen.getByText('Sent 2 invites')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage invites/ })).toHaveAttribute(
      'href',
      '/admin/users'
    )

    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }))
    expect(mocks.openInviteDialog).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send invites' }))
    expect(mocks.sendInvites).toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Add email domain'), {
      target: { value: 'bad domain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(screen.getByText('Enter a valid domain, e.g. acme.com')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Add email domain'), {
      target: { value: '@Example.COM' },
    })
    fireEvent.keyDown(screen.getByLabelText('Add email domain'), { key: 'Enter' })
    await waitFor(() => {
      expect(mocks.updatePortalAccessFn).toHaveBeenCalledWith({
        data: {
          visibility: 'private',
          allowedDomains: ['acme.com', 'example.com'],
          widgetSignIn: true,
          allowedSegmentIds: ['segment_1'],
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove acme.com' }))
    await waitFor(() => {
      expect(mocks.updatePortalAccessFn).toHaveBeenCalledWith({
        data: {
          visibility: 'private',
          allowedDomains: ['example.com'],
          widgetSignIn: true,
          allowedSegmentIds: ['segment_1'],
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pick trial segment' }))
    await waitFor(() => {
      expect(mocks.updatePortalAccessFn).toHaveBeenCalledWith({
        data: expect.objectContaining({ allowedSegmentIds: ['segment_2'] }),
      })
    })

    fireEvent.click(screen.getByLabelText('Allow widget-authenticated users to access the portal'))
    await waitFor(() => {
      expect(mocks.updatePortalAccessFn).toHaveBeenCalledWith({
        data: expect.objectContaining({ widgetSignIn: false }),
      })
    })
  })

  it('confirms private visibility and reverts optimistic access changes on save failure', async () => {
    mocks.updatePortalAccessFn.mockRejectedValueOnce(new Error('denied'))
    render(<PortalAuthTab portalConfig={{ access: { visibility: 'public' } } as never} />)

    fireEvent.click(screen.getByRole('button', { name: /Private/ }))
    expect(screen.getByText('Private portal confirmation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel private' }))
    expect(screen.queryByText('Private portal confirmation')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Private/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm private' }))
    await waitFor(() => {
      expect(mocks.updatePortalAccessFn).toHaveBeenCalledWith({
        data: {
          visibility: 'private',
          allowedDomains: [],
          widgetSignIn: false,
          allowedSegmentIds: [],
        },
      })
    })
    expect(screen.queryByText('Your team always has access.')).not.toBeInTheDocument()
  })

  it('renders segment loading, error, and empty states', () => {
    mocks.query = { data: undefined, isLoading: true, isError: false }
    const { rerender } = render(<PortalAuthTab portalConfig={privateConfig()} />)
    expect(screen.getByText(/Loading segments/)).toBeInTheDocument()

    mocks.query = { data: undefined, isLoading: false, isError: true }
    rerender(<PortalAuthTab portalConfig={privateConfig()} />)
    expect(
      screen.getByText('Could not load segments. Reload the page to try again.')
    ).toBeInTheDocument()

    mocks.query = { data: [], isLoading: false, isError: false }
    rerender(<PortalAuthTab portalConfig={privateConfig()} />)
    expect(
      screen.getByText('No segments defined yet. Create segments in Customers.')
    ).toBeInTheDocument()
  })
})
