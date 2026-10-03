// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'

const hoisted = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(async () => {}),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => hoisted.navigate }))
vi.mock('@/lib/server/functions/onboarding', () => ({ saveWorkspaceAndGoalFn: hoisted.save }))
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
  feedbackPrivate?: boolean
}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <WorkspaceStep
        isCloudProvisioned={false}
        cloudIdentity={null}
        existingWorkspaceName="Acme"
        managedFieldPaths={props.managedFieldPaths}
        setupGoals={{ goals: props.goals, feedbackPrivate: props.feedbackPrivate }}
      />
    </IntlProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  hoisted.save.mockReset()
  hoisted.save.mockResolvedValue({ enabledModules: [] })
  hoisted.navigate.mockClear()
})
afterEach(cleanup)

describe('self-hosted workspace step goals', () => {
  it('shows goals a config file manages read-only and never submits them', async () => {
    renderStep({
      managedFieldPaths: ['workspace.useCase'],
      goals: ['customer_support', 'help_center'],
      feedbackPrivate: false,
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

    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save).toHaveBeenCalledWith({ data: { workspaceName: 'Acme' } })
    await waitFor(() => expect(hoisted.navigate).toHaveBeenCalledWith({ to: '/admin' }))
  })

  it('starts from the stored goals and submits the selection when nothing manages it', async () => {
    renderStep({
      managedFieldPaths: [],
      goals: ['status_page', 'customer_support'],
      feedbackPrivate: false,
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
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save).toHaveBeenCalledWith({
      data: {
        workspaceName: 'Acme',
        goals: ['status_page', 'customer_support'],
        feedbackPrivate: false,
      },
    })
  })

  it('defaults a fresh install to Feedback', async () => {
    renderStep({ managedFieldPaths: [] })
    expect(screen.getByRole('button', { name: 'Feedback & roadmap' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
    await waitFor(() =>
      expect(hoisted.save).toHaveBeenCalledWith({
        data: { workspaceName: 'Acme', goals: ['product_feedback'], feedbackPrivate: false },
      })
    )
  })
})
