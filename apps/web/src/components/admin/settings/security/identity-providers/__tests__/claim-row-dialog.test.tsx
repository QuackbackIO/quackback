// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClaimRowDialog } from '../claim-row-dialog'
import { availableAddTargets } from '../provider-shared'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({
    open: vi.fn(),
    lastSuccess: {
      registrationId: 'oidc_x',
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'sub', sources: {} },
      claims: { sub: 'person-123', upn: 'jane@example.test', groups: ['engineering'] },
    },
    lastCapture: {
      registrationId: 'oidc_x',
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'sub', sources: {} },
      claims: { sub: 'person-123', upn: 'jane@example.test', groups: ['engineering'] },
    },
  }),
}))

vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: () => <button type="button">Test sign-in</button>,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const DEFS = [
  { key: 'department', label: 'Department', type: 'string' },
  { key: 'plan', label: 'Plan', type: 'string' },
]

describe('ClaimRowDialog', () => {
  it('discards local edits on Cancel without committing', async () => {
    const onCommit = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'email' }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="upn"
        registrationId="oidc_x"
        canTest
        onOpenChange={onOpenChange}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets Name to the default path through the dialog', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'name' }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="preferred_username"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reset to name' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'name', path: null })
  })

  it('locks the target when editing and has no metadata-key field', () => {
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'email' }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="upn"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    expect(screen.getByText('Email (fixed target)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Quackback attribute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/metadata/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/metadata/i)).not.toBeInTheDocument()
  })

  it('offers Role and unused People targets only', async () => {
    const targets = availableAddTargets({
      mapping: { attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] } },
      definitions: DEFS,
    })
    render(
      <ClaimRowDialog
        open
        mode="add"
        availableTargets={targets}
        definitions={DEFS}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Quackback attribute' }))
    expect(screen.getByRole('option', { name: /Role/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Plan/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Department/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Unique user identifier/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Email/ })).not.toBeInTheDocument()
  })

  it('includes sub in identity suggestions', async () => {
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'id' }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="sub"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'IdP claim path' }))
    expect(screen.getAllByText('sub').length).toBeGreaterThan(1)
  })
})
