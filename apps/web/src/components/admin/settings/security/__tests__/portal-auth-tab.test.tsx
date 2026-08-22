// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ isLoading: false, isError: false, data: [] }),
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  updatePortalAccessFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updatePortalConfigFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn(),
}))

vi.mock('@/components/admin/users/use-portal-invites', () => ({
  usePortalInvites: () => ({
    invites: [],
    isLoading: false,
    pendingCount: 0,
    acceptedCount: 0,
    lastSentSummary: null,
    dialogOpen: false,
    openDialog: vi.fn(),
    onOpenChange: vi.fn(),
    emailsInput: '',
    messageInput: '',
    emailError: null,
    batchResults: null,
    sendBusy: false,
    onEmailsChange: vi.fn(),
    onMessageChange: vi.fn(),
    onSend: vi.fn(),
  }),
}))

vi.mock('@/components/admin/users/invite-people-dialog', () => ({
  InvitePeopleDialog: () => null,
}))

vi.mock('@/components/admin/settings/portal-privacy-dialog', () => ({
  PortalPrivacyDialog: () => null,
}))

const { PortalAuthTab } = await import('../portal-auth-tab')

const portal: PortalConfig = {
  ...DEFAULT_PORTAL_CONFIG,
  features: { ...DEFAULT_PORTAL_CONFIG.features, allowAnonymous: true },
}

describe('PortalAuthTab — anonymous interaction', () => {
  it('shows the allow-anonymous switch after visibility and before account signup', () => {
    render(<PortalAuthTab portalConfig={portal} teamOpenSignup />)

    const anonymous = screen.getByRole('switch', { name: 'Allow anonymous interaction' })
    const signup = screen.getByRole('switch', {
      name: 'Allow visitors to create their own portal account',
    })
    expect(anonymous).toBeInTheDocument()
    expect(signup).toBeInTheDocument()
    expect(
      anonymous.compareDocumentPosition(signup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      screen.getByText(
        'When off, all boards require sign-in for voting, commenting, and submitting posts.'
      )
    ).toBeInTheDocument()
  })
})
