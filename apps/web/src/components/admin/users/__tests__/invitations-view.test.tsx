// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const navigate = vi.fn()
const openDialog = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('../use-portal-invites', () => ({
  usePortalInvites: () => ({
    invites: [],
    isLoading: false,
    pendingCount: 0,
    acceptedCount: 0,
    expiredCount: 0,
    canceledCount: 0,
    dialogOpen: false,
    openDialog,
    onOpenChange: vi.fn(),
    emailsInput: '',
    messageInput: '',
    emailError: null,
    batchResults: null,
    sendBusy: false,
    onEmailsChange: vi.fn(),
    onMessageChange: vi.fn(),
    onSend: vi.fn(),
    lastSentSummary: null,
    actionError: null,
    resendConfirm: false,
    handleRevoke: vi.fn(),
    handleResend: vi.fn(),
    revokingId: null,
    resendingId: null,
  }),
}))

const { InvitationsView } = await import('../invitations-view')

afterEach(() => {
  cleanup()
  navigate.mockClear()
  openDialog.mockClear()
})

describe('<InvitationsView>', () => {
  it('uses the standard page header with a small Invite users action', () => {
    render(<InvitationsView status="pending" />)
    const header = document.querySelector('[data-page-header]')!
    expect(header.querySelector('h1')?.textContent).toBe('Invitations')
    const action = header.querySelector('button')!
    expect(action.textContent?.trim()).toBe('Invite users')
    expect(action.className).toContain('h-8')
  })

  it('switches status through line tabs, without count pills', () => {
    render(<InvitationsView status="pending" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Pending', 'Accepted', 'Expired', 'All'])
    expect(tabs[0].closest('[data-variant="line"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Accepted' }))
    expect(navigate).toHaveBeenCalled()
  })

  it('shows a compact empty state and keeps Invite users in the header only', () => {
    render(<InvitationsView status="all" />)
    expect(screen.getByRole('heading', { name: 'No invitations yet' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Invite users' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(openDialog).toHaveBeenCalled()
    expect(document.querySelector('.border-dashed')).toBeNull()
  })
})
