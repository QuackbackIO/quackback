// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClaimRowDialog } from '../claim-row-dialog'
import { availableAddTargets } from '../provider-shared'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const defaultCapture: SsoTestCapture = {
  registrationId: 'oidc_x',
  capturedAt: '2026-09-01T00:00:00.000Z',
  identity: { id: 'sub', sources: {} },
  claims: { sub: 'person-123', upn: 'jane@example.test', groups: ['engineering'] },
}

const { ssoTestRef } = vi.hoisted(() => ({
  ssoTestRef: {
    lastSuccess: null as null | SsoTestCapture,
    lastCapture: null as null | SsoTestCapture,
  },
}))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({
    open: vi.fn(),
    lastSuccess: ssoTestRef.lastSuccess,
    lastCapture: ssoTestRef.lastCapture,
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

beforeEach(() => {
  ssoTestRef.lastSuccess = defaultCapture
  ssoTestRef.lastCapture = defaultCapture
})

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

  it('empty Apply on a default identifier commits path null', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'id' }}
        availableTargets={[]}
        definitions={DEFS}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'id', path: null })
  })

  it('selecting sub from an empty identifier dialog persists explicit sub', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'id' }}
        availableTargets={[]}
        definitions={DEFS}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'IdP claim path' }))
    await userEvent.click(screen.getByRole('option', { name: /^sub\b/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'id', path: 'sub' })
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

  it('disables Apply to draft when a new role rule has no value', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'role' }}
        availableTargets={[]}
        definitions={DEFS}
        initialRole={{
          claimPath: 'groups',
          rules: [{ whenContains: 'engineering', role: 'member' }],
        }}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    expect(screen.getByRole('button', { name: 'Apply to draft' })).not.toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(screen.getByRole('button', { name: 'Apply to draft' })).toBeDisabled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('prefers the capture prop over lastSuccess for role value suggestions', async () => {
    ssoTestRef.lastSuccess = {
      ...defaultCapture,
      claims: { sub: 'person-123', groups: ['from-success'] },
    }
    ssoTestRef.lastCapture = ssoTestRef.lastSuccess
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'role' }}
        availableTargets={[]}
        definitions={DEFS}
        initialRole={{
          claimPath: 'groups',
          rules: [{ whenContains: 'engineering', role: 'member' }],
        }}
        registrationId="oidc_x"
        canTest
        capture={{
          ...defaultCapture,
          claims: { sub: 'person-123', groups: ['from-capture'] },
        }}
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Claim value to match (rule 1)' }))
    expect(screen.getByText('from-capture')).toBeInTheDocument()
    expect(screen.queryByText('from-success')).not.toBeInTheDocument()
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

  it('does not let an admin select a non-bindable identity suggestion', async () => {
    ssoTestRef.lastSuccess = {
      ...defaultCapture,
      claims: { sub: 'person-123', email_verified: true, groups: ['engineering'] },
    }
    ssoTestRef.lastCapture = ssoTestRef.lastSuccess
    const onCommit = vi.fn()
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
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'IdP claim path' }))
    const groups = screen.getByRole('option', { name: /groups/i })
    expect(groups).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(groups)
    expect(screen.getByRole('combobox', { name: 'IdP claim path' })).toHaveTextContent('sub')
  })

  it('does not reset in-progress edits when the parent re-renders', () => {
    const targets = availableAddTargets({ mapping: null, definitions: DEFS })
    const { rerender } = render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'email' }}
        availableTargets={targets}
        definitions={DEFS}
        initialPath="upn"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: 'IdP claim path' })).toHaveTextContent('upn')
    rerender(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'email' }}
        availableTargets={[...targets]}
        definitions={[...DEFS]}
        initialPath="email"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: 'IdP claim path' })).toHaveTextContent('upn')
  })

  it('commits a People edit with the row baseline index', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'people', attributeKey: 'department', baselineIndex: 1 }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="org.department"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    expect(onCommit).toHaveBeenCalledWith({
      type: 'people',
      attributeKey: 'department',
      claimPath: 'org.department',
      baselineIndex: 1,
    })
  })
})
