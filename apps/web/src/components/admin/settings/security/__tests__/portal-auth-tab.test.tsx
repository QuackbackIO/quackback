// @vitest-environment happy-dom
import { render as baseRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@/lib/server/functions/portal-access', () => ({
  updatePortalAccessFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updatePortalConfigFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn().mockResolvedValue([]),
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
const { updatePortalConfigFn } = await import('@/lib/server/functions/settings')
const { updatePortalAccessFn } = await import('@/lib/server/functions/portal-access')

function render(ui: React.ReactElement) {
  const client = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return baseRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

const portal: PortalConfig = {
  ...DEFAULT_PORTAL_CONFIG,
  features: { ...DEFAULT_PORTAL_CONFIG.features, allowAnonymous: true },
}

describe('PortalAuthTab: anonymous interaction', () => {
  it('shows the allow-anonymous switch after visibility and before account signup', () => {
    render(<PortalAuthTab portalConfig={portal} teamOpenSignup />)

    const anonymous = screen.getByRole('switch', { name: 'Allow anonymous interaction' })
    const signup = screen.getByRole('switch', { name: 'Let visitors create an account' })
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

describe('PortalAuthTab: visibility and autosave', () => {
  it('offers visibility as radio tiles in the shared vocabulary', () => {
    render(<PortalAuthTab portalConfig={portal} teamOpenSignup />)
    expect(screen.getByRole('radio', { name: /^Everyone/ })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: /^Only your team and users you invite/ })
    ).not.toBeChecked()
    expect(screen.queryByText('Public')).toBeNull()
    expect(screen.queryByText('Private')).toBeNull()
  })

  it('renders account signup as one setting row with no card header', () => {
    render(<PortalAuthTab portalConfig={portal} teamOpenSignup />)
    expect(screen.queryByRole('heading', { name: 'Account signup' })).toBeNull()
    expect(screen.getByText('Let visitors create an account')).toBeInTheDocument()
  })

  it('reverts a failed signup toggle and shows the one autosave toast', async () => {
    vi.mocked(updatePortalConfigFn).mockRejectedValue(new Error('boom'))
    render(<PortalAuthTab portalConfig={portal} teamOpenSignup />)

    const signup = screen.getByRole('switch', { name: 'Let visitors create an account' })
    expect(signup).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(signup)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."))
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Let visitors create an account' })
      ).toHaveAttribute('aria-checked', 'true')
    )
    expect(updatePortalAccessFn).not.toHaveBeenCalled()
  })
})

describe('PortalAuthTab: widget sign-in', () => {
  it('names the switch by its visible label', () => {
    render(
      <PortalAuthTab
        portalConfig={{ ...portal, access: { visibility: 'private' } } as PortalConfig}
        teamOpenSignup
      />
    )
    expect(screen.getByRole('switch', { name: 'Widget sign-in' })).toBeInTheDocument()
  })
})
