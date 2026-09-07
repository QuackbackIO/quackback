// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvancedSourcesEditor, ClaimsTable } from '../claims-table'
import { buildClaimsTableModel } from '../provider-shared'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'

const DEFS = [
  { key: 'department', label: 'Department', type: 'string' },
  { key: 'plan', label: 'Plan', type: 'string' },
]

function renderTable(
  mapping: IdentityProviderClaimMapping | null,
  over: Partial<Parameters<typeof ClaimsTable>[0]> = {}
) {
  const model = buildClaimsTableModel({ mapping, definitions: DEFS })
  const onEdit = vi.fn()
  const onRemove = vi.fn()
  const onResetName = vi.fn()
  const onAllow = vi.fn()
  const onFlags = vi.fn()
  render(
    <ClaimsTable
      requiredRows={model.required}
      additionalRows={model.additional}
      allowMissingEmail={mapping?.profile?.allowMissingEmail === true}
      onAllowMissingEmailChange={onAllow}
      peopleFlags={{
        overrideExisting: mapping?.attributes?.overrideExisting === true,
        syncOnSignIn: mapping?.attributes?.syncOnSignIn === true,
      }}
      onPeopleFlagsChange={onFlags}
      onEdit={onEdit}
      onRemove={onRemove}
      onResetName={onResetName}
      autoCreateUsers
      autoProvisionRole="user"
      {...over}
    />
  )
  return { onEdit, onRemove, onResetName, onAllow, onFlags }
}

describe('ClaimsTable', () => {
  it('uses Quackback attribute then IdP claim column headers', () => {
    renderTable(null)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Quackback attribute')
    expect(headers[1]).toHaveTextContent('IdP claim')
  })

  it('always shows required identifier/email and default display name', () => {
    renderTable(null)
    expect(screen.getByText('Unique user identifier')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Display name')).toBeInTheDocument()
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('sub')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
  })

  it('pins explicit sub as a custom identifier', () => {
    renderTable({ profile: { claims: { id: 'sub' } } })
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit Unique user identifier mapping' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Remove Unique user identifier/ })
    ).not.toBeInTheDocument()
  })

  it('labels edit and delete actions accessibly and never deletes a required row', () => {
    renderTable({
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'engineering', role: 'member' }],
      },
      attributes: { map: [{ claimPath: 'org.department', attributeKey: 'department' }] },
    })
    expect(
      screen.getByRole('button', { name: 'Edit Unique user identifier mapping' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Email mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Display name mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Role mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Role mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Department mapping' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Remove Unique user identifier/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Email/ })).not.toBeInTheDocument()
  })

  it('restores the default name row through Reset mapping', async () => {
    const { onResetName } = renderTable({
      profile: { claims: { name: 'preferred_username' } },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Reset mapping' }))
    expect(onResetName).toHaveBeenCalledTimes(1)
  })

  it('preserves orphaned and duplicate People rows', () => {
    renderTable({
      attributes: {
        map: [
          { claimPath: 'dept', attributeKey: 'department' },
          { claimPath: 'org.department', attributeKey: 'department' },
          { claimPath: 'cc', attributeKey: 'cost_center' },
        ],
      },
    })
    expect(screen.getAllByText('Duplicate mapping')).toHaveLength(2)
    expect(screen.getByText('attribute no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove cost_center mapping' })).toBeInTheDocument()
  })

  it('keeps People flags section-wide and has no metadata-key text field', () => {
    renderTable({
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    })
    expect(screen.getByText('Applies to all mapped People attributes')).toBeInTheDocument()
    expect(screen.getByLabelText('Overwrite values that are already set')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Clear an attribute when its claim is missing')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/metadata/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/metadata/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /key/i })).not.toBeInTheDocument()
  })

  it('does not offer Remove on an unsupported saved profile claim', () => {
    renderTable({
      profile: { claims: { email: 'upn', locale: 'locale' } },
    } as IdentityProviderClaimMapping)
    expect(screen.getByText('locale')).toBeInTheDocument()
    expect(screen.getByText(/not editable here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove locale/ })).not.toBeInTheDocument()
  })

  it('lists every role target and the off-domain warning', () => {
    renderTable({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    })
    expect(screen.getByText(/platform-admins/)).toBeInTheDocument()
    expect(screen.getByText(/engineering/)).toBeInTheDocument()
    expect(screen.getByText(/even outside this provider's verified domains/)).toBeInTheDocument()
  })
})

describe('AdvancedSourcesEditor', () => {
  it('shows default sources and the access-token warning', () => {
    const onChange = vi.fn()
    render(<AdvancedSourcesEditor sources={['idToken', 'userinfo']} onChange={onChange} />)
    const details = screen.getByText('Advanced sources').closest('details')
    expect(details).toBeTruthy()
    if (details) details.open = true
    expect(screen.getByLabelText('ID token')).toBeChecked()
    expect(screen.getByLabelText('Userinfo')).toBeChecked()
    expect(screen.getByLabelText('Access-token JWT')).not.toBeChecked()
    expect(screen.getByText(/audience-scoped and its subject may differ/)).toBeInTheDocument()
  })
})
