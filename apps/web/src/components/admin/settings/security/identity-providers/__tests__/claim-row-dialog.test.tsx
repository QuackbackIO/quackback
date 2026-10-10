// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClaimRowDialog } from '../claim-row-dialog'
import { availableAddTargets } from '../provider-shared'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'

beforeAll(() => {
  // happy-dom never loads images and reports every one as already failed;
  // keep them loading so a test drives failure with an error event.
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => false,
  })
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
    await userEvent.click(screen.getByRole('button', { name: 'Use name' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    await userEvent.click(screen.getByRole('option', { name: /^sub\b/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'id', path: 'sub' })
  })

  it('names the target in the title when editing, with no picker and no metadata-key field', () => {
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
    expect(screen.getByRole('heading', { name: 'Edit Email mapping' })).toBeInTheDocument()
    expect(screen.queryByText(/fixed target/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Set from this provider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/metadata/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/metadata/i)).not.toBeInTheDocument()
  })

  it('offers unused People targets only, never role rules', async () => {
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Set from this provider' }))
    // Role rules live on the Roles card.
    expect(screen.queryByRole('option', { name: /Role rules/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Plan/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Department/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Account ID/ })).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    const groups = screen.getByRole('option', { name: /groups/i })
    expect(groups).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(groups)
    expect(screen.getByRole('combobox', { name: 'Provider claim' })).toHaveTextContent('sub')
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
    expect(screen.getByRole('combobox', { name: 'Provider claim' })).toHaveTextContent('upn')
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
    expect(screen.getByRole('combobox', { name: 'Provider claim' })).toHaveTextContent('upn')
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
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onCommit).toHaveBeenCalledWith({
      type: 'people',
      attributeKey: 'department',
      claimPath: 'org.department',
      baselineIndex: 1,
    })
  })
})

const avatarCapture: SsoTestCapture = {
  version: 2,
  registrationId: 'oidc_x',
  capturedAt: '2026-09-01T00:00:00.000Z',
  detailsChangedAtAtStart: null,
  outcome: 'success',
  claims: {},
  replay: {
    sources: [
      {
        source: 'idToken',
        claims: {
          sub: 'person-123',
          name: 'Sam Lee',
          email: 'you@example.com',
          photo_url: 'https://cdn.example.com/photos/123',
          profile: { photo: 'https://cdn.example.com/p/9' },
          groups: ['support', 'admins'],
        },
      },
      { source: 'userinfo', claims: { sub: 'person-123' } },
    ],
  },
}

function renderAvatarDialog(
  over: {
    initialPath?: string
    capture?: SsoTestCapture | null
    draft?: IdentityProviderClaimMapping | null
  } = {}
) {
  const onCommit = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <ClaimRowDialog
      open
      mode="edit"
      lockedTarget={{ type: 'profile', field: 'image' }}
      availableTargets={[]}
      definitions={DEFS}
      initialPath={over.initialPath}
      registrationId="oidc_x"
      canTest
      capture={over.capture === undefined ? avatarCapture : over.capture}
      draft={over.draft}
      onOpenChange={onOpenChange}
      onCommit={onCommit}
    />
  )
  return { onCommit, onOpenChange }
}

const claimInput = () => screen.getByRole('textbox', { name: 'Provider claim' })
const typeClaim = (value: string) => fireEvent.change(claimInput(), { target: { value } })
const applyButton = () => screen.getByRole('button', { name: 'Apply' })
const claimList = () => screen.getByRole('list', { name: 'Claims in your last test sign-in' })
const claimButton = (path: string) =>
  within(claimList())
    .getAllByRole('button')
    .find((b) => b.querySelector('code')?.textContent === path)!

describe('ClaimRowDialog avatar', () => {
  it('asks for the claim that links to the picture', () => {
    renderAvatarDialog()
    expect(screen.getByRole('heading', { name: 'Edit Avatar mapping' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      "Choose the claim that holds a link to the person's picture."
    )
    expect(claimInput()).toHaveAttribute('placeholder', 'picture')
    expect(screen.getByText('For a nested claim use a dot, like profile.photo')).toBeInTheDocument()
  })

  it('shows the picture for an image URL with no file extension and applies it', async () => {
    const { onCommit } = renderAvatarDialog()
    typeClaim('photo_url')
    expect(screen.getByRole('status')).toHaveTextContent('Shows this picture')
    expect(screen.getByRole('img', { name: 'Picture from the test sign-in' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/photos/123'
    )
    expect(claimInput()).not.toHaveAttribute('aria-invalid', 'true')
    await userEvent.click(applyButton())
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'image', path: 'photo_url' })
  })

  it('blocks Apply for a claim that is not an image URL', () => {
    const { onCommit } = renderAvatarDialog()
    typeClaim('name')
    expect(screen.getByRole('status')).toHaveTextContent('Not an image URL')
    expect(claimInput()).toHaveAttribute('aria-invalid', 'true')
    expect(applyButton()).toBeDisabled()
    fireEvent.click(applyButton())
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('allows a claim the last test sign-in did not send', async () => {
    const { onCommit } = renderAvatarDialog()
    typeClaim('photo.large')
    expect(screen.getByRole('status')).toHaveTextContent('Not in the last test sign-in')
    expect(applyButton()).not.toBeDisabled()
    await userEvent.click(applyButton())
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'image', path: 'photo.large' })
  })

  it('warns when the picture does not load and still allows Apply', () => {
    renderAvatarDialog()
    typeClaim('photo_url')
    fireEvent.error(screen.getByRole('img', { name: 'Picture from the test sign-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Could not load this picture')
    expect(applyButton()).not.toBeDisabled()
  })

  it('lists every claim from the test sign-in and fills the input from a click', async () => {
    renderAvatarDialog()
    const paths = within(claimList())
      .getAllByRole('button')
      .map((b) => b.querySelector('code')?.textContent)
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'photo_url', 'profile.photo']))
    // Nothing is chosen for the admin.
    expect(claimInput()).toHaveValue('')
    for (const button of within(claimList()).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    expect(claimButton('photo_url').querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/photos/123'
    )
    expect(claimButton('name').querySelector('img')).toBeNull()
    await userEvent.click(claimButton('profile.photo'))
    expect(claimInput()).toHaveValue('profile.photo')
    expect(claimButton('profile.photo')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Shows this picture')
  })

  it('hides a listed thumbnail that does not load', () => {
    renderAvatarDialog()
    fireEvent.error(claimButton('photo_url').querySelector('img')!)
    expect(claimButton('photo_url').querySelector('img')).toBeNull()
    expect(claimButton('photo_url')).toHaveTextContent('https://cdn.example.com/photos/123')
  })

  it('asks for a test sign-in when there is none', () => {
    ssoTestRef.lastSuccess = null
    ssoTestRef.lastCapture = null
    renderAvatarDialog({ capture: null })
    expect(screen.getByRole('status')).toHaveTextContent('Run a test sign-in to preview')
    expect(screen.getByRole('button', { name: 'Test sign-in' })).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Claims in your last test sign-in' })
    ).not.toBeInTheDocument()
    expect(applyButton()).not.toBeDisabled()
  })

  it('previews the standard picture claim while the input is empty', () => {
    renderAvatarDialog({
      capture: {
        ...avatarCapture,
        replay: {
          sources: [
            {
              source: 'idToken',
              claims: { sub: 'person-123', picture: 'https://cdn.example.com/a' },
            },
            { source: 'userinfo', claims: { sub: 'person-123' } },
          ],
        },
      },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Shows this picture')
  })

  it('takes the URL from a later source when an earlier one is not a URL, as sign-in does', () => {
    renderAvatarDialog({
      capture: {
        ...avatarCapture,
        replay: {
          sources: [
            { source: 'idToken', claims: { sub: 'person-123', photo_url: 'photo-123' } },
            {
              source: 'userinfo',
              claims: { sub: 'person-123', photo_url: 'https://cdn.example.com/photos/123' },
            },
          ],
        },
      },
    })
    typeClaim('photo_url')
    expect(screen.getByRole('status')).toHaveTextContent('Shows this picture')
    expect(screen.getByRole('img', { name: 'Picture from the test sign-in' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/photos/123'
    )
    expect(applyButton()).not.toBeDisabled()
  })

  it('ignores a source the draft does not read', () => {
    const capture: SsoTestCapture = {
      ...avatarCapture,
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'person-123', name: 'Sam Lee' } },
          {
            source: 'userinfo',
            claims: { sub: 'person-123', photo_url: 'https://cdn.example.com/photos/123' },
          },
        ],
      },
    }
    renderAvatarDialog({ capture, draft: { profile: { sources: ['idToken'] } } })
    typeClaim('photo_url')
    expect(screen.getByRole('status')).toHaveTextContent('Not in the last test sign-in')
    expect(
      within(claimList())
        .getAllByRole('button')
        .map((b) => b.querySelector('code')?.textContent)
    ).not.toContain('photo_url')
  })

  it('says a picture cannot be previewed when the draft reads a source the test did not capture', () => {
    renderAvatarDialog({ draft: { profile: { sources: ['idToken', 'accessTokenJwt'] } } })
    typeClaim('photo_url')
    expect(screen.getByRole('status')).toHaveTextContent('Run a test sign-in to preview')
    expect(applyButton()).not.toBeDisabled()
  })

  it('returns to picture through the reset button', async () => {
    const { onCommit } = renderAvatarDialog({ initialPath: 'photo_url' })
    expect(claimInput()).toHaveValue('photo_url')
    await userEvent.click(screen.getByRole('button', { name: 'Use picture' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'image', path: null })
  })
})

describe('ClaimRowDialog profile fields', () => {
  it.each([
    ['id', 'Account ID', /Matches accounts on every sign-in\..*Setting sub explicitly/],
    ['email', 'Email', /^Set when the account is created\.$/],
    ['name', 'Name', /^Set when the account is created\. If missing/],
  ] as const)('titles %s like every field and describes it', (field, label, helper) => {
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field }}
        availableTargets={[]}
        definitions={DEFS}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: `Edit ${label} mapping` })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(helper)
  })
})

describe('ClaimRowDialog username', () => {
  it('keeps an explicit preferred_username, which reads only that claim', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'username' }}
        availableTargets={[]}
        definitions={DEFS}
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'preferred_username' },
    })
    fireEvent.click(screen.getByText(/Use ["“]preferred_username["”]/))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onCommit).toHaveBeenCalledWith({
      type: 'profile',
      field: 'username',
      path: 'preferred_username',
    })
  })

  it('explains when the username is used and what it reads unmapped', async () => {
    const onCommit = vi.fn()
    render(
      <ClaimRowDialog
        open
        mode="edit"
        lockedTarget={{ type: 'profile', field: 'username' }}
        availableTargets={[]}
        definitions={DEFS}
        initialPath="handle"
        registrationId="oidc_x"
        canTest
        onOpenChange={vi.fn()}
        onCommit={onCommit}
      />
    )
    expect(screen.getByRole('heading', { name: 'Edit Username mapping' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Names the account when the provider sends no name. Unmapped, it uses preferred_username, then nickname.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use standard claims' }))
    expect(onCommit).toHaveBeenCalledWith({ type: 'profile', field: 'username', path: null })
  })
})
