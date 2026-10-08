// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'

const hoisted = vi.hoisted(() => ({
  save: vi.fn(),
  checks: vi.fn(),
  navigate: vi.fn(async () => {}),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hoisted.navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('@/lib/server/functions/onboarding', () => ({
  saveWorkspaceAndGoalFn: hoisted.save,
  getInstallChecksFn: hoisted.checks,
}))
vi.mock('@/lib/server/functions/cloud-identity', () => ({
  getCloudIdentityFn: vi.fn(),
  markCloudWorkspaceDetailsSeenFn: vi.fn(),
  updateCloudIdentityFn: vi.fn(),
}))
// The bootstrap payload never carries the private settings blob, so the step
// must not depend on it for the stored goals.
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme', settings: {} }),
}))

import { WorkspaceStep } from '../-workspace-step'

function renderStep(props: {
  managedFieldPaths: string[]
  goals?: ('product_feedback' | 'customer_support' | 'help_center' | 'status_page')[]
  adminName?: string
}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <WorkspaceStep
        isCloudProvisioned={false}
        cloudIdentity={null}
        existingWorkspaceName="Acme"
        managedFieldPaths={props.managedFieldPaths}
        setupGoals={{ goals: props.goals }}
        adminName={props.adminName}
      />
    </IntlProvider>
  )
}

const ALL_SET = {
  email: true,
  storage: true,
  address: { ok: true, baseUrl: 'https://feedback.acme.example', visitedOrigin: null },
}

beforeEach(() => {
  localStorage.clear()
  hoisted.save.mockReset()
  hoisted.save.mockResolvedValue({ enabledModules: [], name: 'Acme' })
  hoisted.checks.mockReset()
  hoisted.checks.mockResolvedValue(ALL_SET)
  hoisted.navigate.mockClear()
})
afterEach(cleanup)

describe('self-hosted workspace step goals', () => {
  it('shows goals a config file manages read-only and never submits them', async () => {
    renderStep({
      managedFieldPaths: ['workspace.useCase'],
      goals: ['customer_support', 'help_center'],
    })

    expect(screen.getByText('Set by your config file')).toBeVisible()
    expect(screen.queryByText('Pick any')).toBeNull()
    const support = screen.getByRole('button', { name: 'Support inbox' })
    const help = screen.getByRole('button', { name: 'Help center' })
    const feedback = screen.getByRole('button', { name: 'Feedback & roadmap' })
    expect(support).toHaveAttribute('aria-pressed', 'true')
    expect(help).toHaveAttribute('aria-pressed', 'true')
    expect(feedback).toHaveAttribute('aria-pressed', 'false')
    for (const tile of [support, help, feedback]) expect(tile).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save).toHaveBeenCalledWith({ data: { workspaceName: 'Acme' } })
    // Setup ends on the ready step, and Home is one deliberate click away.
    fireEvent.click(await screen.findByRole('button', { name: 'Open your workspace' }))
    expect(hoisted.navigate).toHaveBeenCalledWith({ to: '/admin' })
  })

  it('starts from the stored goals and submits the selection when nothing manages it', async () => {
    renderStep({
      managedFieldPaths: [],
      goals: ['status_page', 'customer_support'],
    })

    expect(screen.getByText('Pick any')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Status page' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Feedback & roadmap' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save).toHaveBeenCalledWith({
      data: {
        workspaceName: 'Acme',
        goals: ['status_page', 'customer_support'],
      },
    })
  })

  // Nothing is chosen for the admin: the first goal they pick is the one
  // the launch plan starts with, and the server keeps the order picked.
  it('starts a fresh install with nothing picked and sends the pick order', async () => {
    renderStep({ managedFieldPaths: [] })
    for (const name of ['Feedback & roadmap', 'Support inbox', 'Help center', 'Status page']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Support inbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() =>
      expect(hoisted.save).toHaveBeenCalledWith({
        data: { workspaceName: 'Acme', goals: ['customer_support', 'product_feedback'] },
      })
    )
  })
})

describe('self-hosted workspace step submit', () => {
  // The button says what happens next; the form says what is missing, at the
  // moment it matters, rather than sitting greyed out with no reason.
  it('keeps Create workspace enabled and explains a short name under the field', async () => {
    renderStep({ managedFieldPaths: [], goals: ['product_feedback'] })
    const name = screen.getByLabelText('Workspace name')
    fireEvent.change(name, { target: { value: 'A' } })
    const create = screen.getByRole('button', { name: 'Create workspace' })
    expect(create).toBeEnabled()

    fireEvent.click(create)

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Enter a workspace name with at least 2 characters.')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
    expect(error.parentElement).toBe(name.closest('[data-field]'))
    expect(name).toHaveFocus()
    expect(hoisted.save).not.toHaveBeenCalled()
  })

  // Enter is how a keyboard user submits, so it must reach the check too.
  it('checks the name when Enter is pressed in the field', async () => {
    const user = userEvent.setup()
    renderStep({ managedFieldPaths: [], goals: ['help_center'] })
    const name = screen.getByLabelText('Workspace name')
    await user.clear(name)
    await user.type(name, 'A{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 2 characters/)
    expect(hoisted.save).not.toHaveBeenCalled()

    await user.type(name, 'cme{Enter}')
    await waitFor(() =>
      expect(hoisted.save).toHaveBeenCalledWith({
        data: { workspaceName: 'Acme', goals: ['help_center'] },
      })
    )
  })

  it('asks for a goal when none is picked, and saves nothing', async () => {
    renderStep({ managedFieldPaths: [], goals: ['product_feedback'] })
    fireEvent.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
    expect(screen.queryByText('Pick at least one')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one')
    expect(hoisted.save).not.toHaveBeenCalled()
  })
})

describe('setup buttons while they work', () => {
  // Working is not the same as unavailable: a button that is saving keeps its
  // colour and says so, where a truly disabled one would turn muted.
  it('marks Create workspace and Open your workspace busy while they work', async () => {
    let finishSave: (value: unknown) => void = () => {}
    hoisted.save.mockReturnValue(new Promise((resolve) => (finishSave = resolve)))
    hoisted.navigate.mockReturnValue(new Promise(() => {}))
    renderStep({ managedFieldPaths: [], goals: ['product_feedback'] })
    const create = screen.getByRole('button', { name: 'Create workspace' })
    expect(create).not.toHaveAttribute('aria-busy')

    fireEvent.click(create)
    const saving = await screen.findByRole('button', { name: /Setting up/ })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')

    finishSave({ enabledModules: [], name: 'Acme' })
    const open = await screen.findByRole('button', { name: 'Open your workspace' })
    fireEvent.click(open)
    expect(open).toBeDisabled()
    expect(open).toHaveAttribute('aria-busy', 'true')
  })
})

describe('self-hosted ready step', () => {
  async function finishSetup(
    goals: ('product_feedback' | 'customer_support' | 'help_center' | 'status_page')[],
    adminName?: string
  ) {
    renderStep({ managedFieldPaths: [], goals, adminName })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await screen.findByRole('button', { name: 'Open your workspace' })
  }

  it('does not leave the wizard until the admin opens the workspace', async () => {
    await finishSetup(['product_feedback'])

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme is ready')
    expect(hoisted.navigate).not.toHaveBeenCalled()
  })

  // The step swaps in place, so it has to announce itself: back to the top,
  // focus on its heading, and a title of its own.
  it('opens at the top with focus on its heading and a title of its own', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderStep({ managedFieldPaths: [], goals: ['product_feedback'] })
    expect(document.title).toBe('Name your workspace · Quackback')

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Acme is ready' })

    await waitFor(() => expect(heading).toHaveFocus())
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
    expect(document.title).toBe('Acme is ready · Quackback')
    scrollTo.mockRestore()
  })

  // A real company name must not break the headline or the way in.
  it('keeps a long name readable and the button label short', async () => {
    const long = 'Featherstonehaugh Customer Success Group'
    hoisted.save.mockResolvedValue({ enabledModules: [], name: long })
    await finishSetup(['product_feedback'])

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(`${long} is ready`)
    expect(heading.querySelector('br')).toBeNull()
    expect(heading.className).toMatch(/text-balance/)
    // Scaled down so the name takes fewer lines than a short one would at full size.
    expect(heading.className).toMatch(/text-\[3[02]px\]/)
    const open = screen.getByRole('button', { name: 'Open your workspace' })
    expect(open.textContent).not.toContain('Featherstonehaugh')
    expect(open.querySelector('.truncate')).toBeNull()
  })

  // The checks resolve after the step appears; holding their place keeps
  // the button still while the admin reaches for it.
  it('holds the install rows’ place while the checks load', async () => {
    let resolveChecks: (value: typeof ALL_SET) => void = () => {}
    hoisted.checks.mockReturnValue(new Promise((resolve) => (resolveChecks = resolve)))
    await finishSetup(['product_feedback'])

    const loading = screen.getByText('Checking your install…').closest('section')!
    expect(loading).toHaveAttribute('aria-busy', 'true')
    const placeholders = loading.querySelectorAll('[data-skeleton-row]')
    expect(placeholders).toHaveLength(3)

    resolveChecks(ALL_SET)
    const loaded = (await screen.findByText('Email is set up')).closest('section')!
    expect(loaded.querySelectorAll('li')).toHaveLength(placeholders.length)
  })

  it('lists what was set up for each goal picked', async () => {
    await finishSetup(['product_feedback', 'help_center'], 'Sam Rivera')

    expect(screen.getByText('An admin account for Sam Rivera')).toBeVisible()
    expect(screen.getByText(/Feedback board customers can post and vote on/)).toBeVisible()
    expect(screen.getByText(/help center with a General category/)).toBeVisible()
    expect(screen.queryByText(/support inbox/i)).toBeNull()
    expect(screen.queryByText(/status page/i)).toBeNull()
  })

  it('says so when the install has everything it needs', async () => {
    await finishSetup(['product_feedback'])

    expect(await screen.findByText('Everything your install needs is in place.')).toBeVisible()
    expect(screen.getByText('Email is set up')).toBeVisible()
    expect(screen.getByText('File uploads are set up')).toBeVisible()
    expect(screen.getByText('https://feedback.acme.example')).toBeVisible()
  })

  it('names what is missing, and says it can wait', async () => {
    hoisted.checks.mockResolvedValue({
      email: false,
      storage: false,
      address: {
        ok: false,
        baseUrl: 'http://localhost:3000',
        visitedOrigin: 'http://192.168.1.20:3000',
      },
    })
    await finishSetup(['product_feedback'])

    expect(await screen.findByText('Email isn’t set up yet')).toBeVisible()
    expect(screen.getByText(/Invites and password resets can’t be sent/)).toBeVisible()
    expect(screen.getByText('File uploads aren’t set up yet')).toBeVisible()
    expect(screen.getByText('http://192.168.1.20:3000')).toBeVisible()
    expect(screen.getByText(/set BASE_URL to it/)).toBeVisible()
    expect(
      screen.getByText('You can open your workspace now and finish these later.')
    ).toBeVisible()
    expect(screen.queryByText('Everything your install needs is in place.')).toBeNull()
  })

  // A hosted workspace answers null: the operator is not the admin there.
  it('leaves the install section out where there is nothing to check', async () => {
    hoisted.checks.mockResolvedValue(null)
    await finishSetup(['product_feedback'])

    await waitFor(() => expect(screen.queryByText('Checking your install…')).toBeNull())
    expect(screen.queryByText('Your install')).toBeNull()
  })
})
