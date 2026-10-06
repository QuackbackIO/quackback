// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdentitySourcesEditor, ClaimsTable } from '../claims-table'
import { buildClaimsTableModel } from '../provider-shared'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'

// happy-dom never loads images and reports every one as already failed;
// keep them loading so a test drives failure with an error event.
Object.defineProperty(HTMLImageElement.prototype, 'complete', {
  configurable: true,
  get: () => false,
})

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
      {...over}
    />
  )
  return { onEdit, onRemove, onFlags }
}

describe('ClaimsTable', () => {
  it('names the claim column after the provider, or Provider claim without a label', () => {
    renderTable(null, { providerLabel: 'Acme ID' })
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Field')
    expect(headers[1]).toHaveTextContent('Acme ID claim')
    cleanup()
    renderTable(null)
    expect(screen.getAllByRole('columnheader')[1]).toHaveTextContent('Provider claim')
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
      attributes: { map: [{ claimPath: 'org.department', attributeKey: 'department' }] },
    })
    expect(screen.getByRole('button', { name: 'Edit Account ID mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Email mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Name mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Department mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Email/ })).not.toBeInTheDocument()
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
      screen.getByRole('checkbox', { name: 'Overwrite attribute values that are already set' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Clear an attribute when its claim is missing' })
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

  it('has no role row: role rules live on the Roles card', () => {
    renderTable({
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'platform-admins', role: 'admin' }],
      },
    })
    expect(screen.queryByText('platform-admins')).not.toBeInTheDocument()
    expect(screen.queryByText('Role')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /role rules/ })).not.toBeInTheDocument()
  })
})

/** The table row whose Field label is exactly `label`. */
function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: 'span' }).closest('tr')
  if (!row) throw new Error(`No row for ${label}`)
  return row
}

const TEST_VALUES = {
  id: 'person-123',
  email: 'jane@example.test',
  name: 'Jane',
  image: 'https://cdn.example.com/photos/123',
}

describe('ClaimsTable profile rows', () => {
  it('lists Username and Avatar after Name, each with its standard claim', () => {
    renderTable(null)
    const labels = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td span')?.textContent)
    expect(labels).toEqual(['Account ID', 'Email', 'Name', 'Username', 'Avatar'])
    expect(within(rowFor('Username')).getByText('preferred_username')).toBeInTheDocument()
    expect(within(rowFor('Avatar')).getByText('picture')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Avatar mapping' })).toBeInTheDocument()
  })

  it('says under each label what the field expects', () => {
    renderTable(null)
    for (const [label, hint] of [
      ['Account ID', 'Unique, never changes'],
      ['Email', 'Email address'],
      ['Name', 'Display name'],
      ['Username', 'Used when no name is sent'],
      ['Avatar', 'Image URL'],
    ]) {
      expect(within(rowFor(label)).getByText(hint)).toBeInTheDocument()
    }
  })
})

describe('ClaimsTable test sign-in column', () => {
  it('shows what each profile field takes from the test sign-in, only when there is one', () => {
    const untested = render(
      <ClaimsTable
        profileRows={buildClaimsTableModel({ mapping: null, definitions: DEFS }).profile}
        additionalRows={[]}
        peopleFlags={{ overrideExisting: false, syncOnSignIn: false }}
        onPeopleFlagsChange={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        testValues={null}
      />
    )
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
    expect(screen.queryByText('Last test sign-in')).not.toBeInTheDocument()
    untested.unmount()
    renderTable(null, {
      providerLabel: 'Acme ID',
      testValues: { ...TEST_VALUES, username: 'jane.d' },
    })
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'Field',
      'Acme ID claim',
      'Last test sign-in',
      'Actions',
    ])
    expect(within(rowFor('Account ID')).getByText('person-123')).toBeInTheDocument()
    expect(within(rowFor('Email')).getByText('jane@example.test')).toBeInTheDocument()
    expect(within(rowFor('Name')).getByText('Jane')).toBeInTheDocument()
    expect(within(rowFor('Username')).getByText('jane.d')).toBeInTheDocument()
    const avatar = rowFor('Avatar')
    expect(within(avatar).getByText('https://cdn.example.com/photos/123')).toBeInTheDocument()
    const img = avatar.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/photos/123')
    // Loaded the way the app's own avatars are.
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).not.toHaveAttribute('referrerpolicy')
  })

  it('says initials are shown when no avatar is sent and the name when no username is', () => {
    renderTable(null, { testValues: { id: 'person-123', email: 'jane@example.test' } })
    const avatar = rowFor('Avatar')
    expect(within(avatar).getByText('Not sent, initials are shown')).toBeInTheDocument()
    expect(avatar.querySelector('img')).toBeNull()
    expect(within(rowFor('Username')).getByText('Name is used')).toBeInTheDocument()
    expect(within(rowFor('Name')).getByText('Not sent')).toBeInTheDocument()
  })

  it('falls back to an empty picture when the avatar does not load', () => {
    renderTable(null, { testValues: TEST_VALUES })
    const avatar = rowFor('Avatar')
    fireEvent.error(avatar.querySelector('img')!)
    expect(avatar.querySelector('img')).toBeNull()
    expect(within(avatar).getByText('https://cdn.example.com/photos/123')).toBeInTheDocument()
  })

  it('leaves the test column empty for People rows', () => {
    renderTable(
      {
        attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      },
      { testValues: TEST_VALUES }
    )
    for (const name of ['Edit Department mapping']) {
      const cells = within(screen.getByRole('button', { name }).closest('tr')!).getAllByRole('cell')
      expect(cells).toHaveLength(4)
      expect(cells[2]).toBeEmptyDOMElement()
    }
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
