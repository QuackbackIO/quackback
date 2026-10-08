// @vitest-environment happy-dom
/**
 * What the self-hosted workspace step does with each answer the save can give.
 *
 * The save is the server boundary, so it is the one thing stubbed: each test
 * hands the real form one of the answers `saveWorkspaceAndGoalFn` returns and
 * checks where the person ends up and what they are told. None of them may
 * show a server string; each refusal has a next step of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const navigate = vi.fn(async () => {})
const save = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/server/functions/onboarding', () => ({ saveWorkspaceAndGoalFn: save }))
vi.mock('@/lib/server/functions/cloud-identity', () => ({
  getCloudIdentityFn: vi.fn(),
  markCloudWorkspaceDetailsSeenFn: vi.fn(),
  updateCloudIdentityFn: vi.fn(),
}))
vi.mock('@/lib/client/analytics', () => ({ track: vi.fn() }))

import { WorkspaceStep } from '../-workspace-step'

const DRAFT_KEY = 'quackback:onboarding:workspace-name'

function renderStep() {
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <WorkspaceStep
        isCloudProvisioned={false}
        cloudIdentity={null}
        existingWorkspaceName=""
        managedFieldPaths={[]}
      />
    </IntlProvider>
  )
}

function submit(name = 'Fernhill') {
  fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
afterEach(() => cleanup())

describe('workspace step', () => {
  it('opens the workspace once the save goes through', async () => {
    save.mockResolvedValue({
      ok: true,
      id: 'workspace_1',
      name: 'Fernhill',
      slug: 'fernhill',
      useCase: 'product_feedback',
      managed: { name: false, slug: false, useCase: false },
      enabledModules: [],
    })
    renderStep()

    submit()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/admin' }))
  })

  // A form left open in another tab after setup finished. Setup is final, so
  // the person is sent to the workspace that already exists and told why.
  it('sends a save that arrives after setup finished to Home, with a note', async () => {
    save.mockResolvedValue({ ok: false, refusal: 'setup_complete' })
    renderStep()

    submit('Second Tab Co')

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/admin' }))
    expect(toast.info).toHaveBeenCalledWith('Setup is already finished.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  // The session went away mid-setup. A raw "Authentication required" left the
  // form live with no way forward; the way forward is signing back in, and
  // the typed name has to survive the trip.
  it('offers a way to sign back in when the session is gone', async () => {
    save.mockResolvedValue({ ok: false, refusal: 'signed_out' })
    renderStep()

    submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You were signed out. Sign in to finish setting up.')
    expect(screen.queryByText(/authentication required/i)).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')).toMatchObject({
      workspaceName: 'Fernhill',
    })

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/onboarding/account' }))
  })

  // Setup belongs to someone else. The wizard already has a page for that.
  it('sends someone whose setup this is not to the no-access page', async () => {
    save.mockResolvedValue({ ok: false, refusal: 'not_owner' })
    renderStep()

    submit()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/onboarding/no-access' }))
    expect(screen.queryByText(/only admin/i)).toBeNull()
  })
})
