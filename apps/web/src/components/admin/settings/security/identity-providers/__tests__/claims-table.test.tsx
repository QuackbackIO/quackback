// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdentitySourcesEditor, ClaimsTable } from '../claims-table'
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
  const onFlags = vi.fn()
  render(
    <ClaimsTable
      profileRows={model.profile}
      additionalRows={model.additional}
      peopleFlags={{
        overrideExisting: mapping?.attributes?.overrideExisting === true,
        syncOnSignIn: mapping?.attributes?.syncOnSignIn === true,
      }}
      onPeopleFlagsChange={onFlags}
      onEdit={onEdit}
      onRemove={onRemove}
      editable
      {...over}
    />
  )
  return { onEdit, onRemove, onFlags }
}

describe('ClaimsTable', () => {
  it('uses Profile field then Provider claim column headers', () => {
    renderTable(null)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Profile field')
    expect(headers[1]).toHaveTextContent('Provider claim')
  })

  it('shows the three profile fields in one table with no Default badges', () => {
    renderTable(null)
    expect(screen.getByText('Account ID')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('sub')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
    expect(screen.queryByText('Custom')).not.toBeInTheDocument()
    expect(screen.queryByText(/Additional attributes/)).not.toBeInTheDocument()
  })

  it('marks an explicit sub as the one Custom exception and never offers to remove it', () => {
    renderTable({ profile: { claims: { id: 'sub' } } })
    expect(screen.getAllByText('Custom')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Edit Account ID mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Account ID/ })).not.toBeInTheDocument()
  })

  it('labels edit and remove actions accessibly and never removes a profile row', () => {
    renderTable({
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'engineering', role: 'member' }],
      },
      attributes: { map: [{ claimPath: 'org.department', attributeKey: 'department' }] },
    })
    expect(screen.getByRole('button', { name: 'Edit Account ID mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Email mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Name mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit role rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove role rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Department mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Email/ })).not.toBeInTheDocument()
  })

  it('renders read-only with no action column or flag checkboxes', () => {
    renderTable(
      { attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] } },
      { editable: false }
    )
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
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
    expect(screen.getAllByText('Duplicate')).toHaveLength(2)
    expect(screen.getByText('Attribute no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove cost_center mapping' })).toBeInTheDocument()
  })

  it('keeps People flags section-wide and has no metadata-key text field', () => {
    renderTable({
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    })
    expect(
      screen.getByLabelText('Overwrite attribute values that are already set')
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Clear an attribute when its claim is missing')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/metadata/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /key/i })).not.toBeInTheDocument()
  })

  it('does not offer Remove on an unsupported saved profile claim', () => {
    renderTable({
      profile: { claims: { email: 'upn', locale: 'locale' } },
    } as IdentityProviderClaimMapping)
    expect(screen.getByText('locale')).toBeInTheDocument()
    expect(screen.getByText(/Not editable here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove locale/ })).not.toBeInTheDocument()
  })

  it('lists the role rules without repeating the domain warning', () => {
    renderTable({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    })
    expect(screen.getByText('platform-admins')).toBeInTheDocument()
    expect(screen.getByText('engineering')).toBeInTheDocument()
    expect(screen.queryByText(/verified domains/)).not.toBeInTheDocument()
  })
})

describe('IdentitySourcesEditor', () => {
  it('shows the standard sources checked and the access token off with its caveat', () => {
    const onChange = vi.fn()
    render(<IdentitySourcesEditor sources={['idToken', 'userinfo']} onChange={onChange} />)
    expect(screen.getByLabelText('ID token')).toBeChecked()
    expect(screen.getByLabelText('Userinfo')).toBeChecked()
    expect(screen.getByLabelText('Access-token JWT')).not.toBeChecked()
    expect(screen.getByText(/may be issued for another API/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use standard sources' })).not.toBeInTheDocument()
  })

  it('offers to return to the standard sources only when they differ', async () => {
    const onChange = vi.fn()
    render(<IdentitySourcesEditor sources={['userinfo', 'idToken']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Use standard sources' }))
    expect(onChange).toHaveBeenCalledWith(['idToken', 'userinfo'])
  })
})
