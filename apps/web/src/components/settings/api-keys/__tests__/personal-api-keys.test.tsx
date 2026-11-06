// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { ApiKey } from '@/lib/shared/types'

const { createMine } = vi.hoisted(() => ({ createMine: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('@/lib/server/functions/personal-api-keys', () => ({
  createMyApiKeyFn: createMine,
  rotateMyApiKeyFn: vi.fn(),
  renameMyApiKeyFn: vi.fn(),
  revokeMyApiKeyFn: vi.fn(),
}))
vi.mock('@/components/admin/settings/api-keys/api-key-reveal-dialog', () => ({
  ApiKeyRevealDialog: ({ open, keyName }: { open: boolean; keyName: string }) =>
    open ? <p>Revealing {keyName}</p> : null,
}))
vi.mock('@/components/admin/settings/api-keys/rotate-api-key-dialog', () => ({
  RotateApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKey }) =>
    open ? <p>Rotating {apiKey.name}</p> : null,
}))
vi.mock('@/components/admin/settings/api-keys/rename-api-key-dialog', () => ({
  RenameApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKey }) =>
    open ? <p>Renaming {apiKey.name}</p> : null,
}))
vi.mock('@/components/admin/settings/api-keys/revoke-api-key-dialog', () => ({
  RevokeApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKey }) =>
    open ? <p>Revoking {apiKey.name}</p> : null,
}))

const { PersonalApiKeys } = await import('../personal-api-keys')
const { CreatePersonalKeyDialog } = await import('../create-personal-key-dialog')

function wrap(node: React.ReactNode) {
  return render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function key(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'api_key_1',
    name: 'Inbox triage script',
    kind: 'personal',
    keyPrefix: 'qb_51c0e2a9f',
    createdAt: new Date('2026-11-01'),
    lastUsedAt: null,
    expiresAt: null,
    scopes: ['read:chat', 'write:chat'],
    ...over,
  } as unknown as ApiKey
}

describe('PersonalApiKeys', () => {
  it('says what a personal key is and lists my keys', () => {
    wrap(<PersonalApiKeys apiKeys={[key()]} canCreate />)
    expect(screen.getAllByText('Keys act as you. They can see and do what you can.').length).toBe(1)
    expect(screen.getByText('Inbox triage script')).toBeInTheDocument()
    expect(screen.getByText(/No expiry · Never used/)).toBeInTheDocument()
    expect(screen.getByText('Conversations (read and write)')).toBeInTheDocument()
  })

  it('disables "New key" and says why when the policy is off', () => {
    wrap(<PersonalApiKeys apiKeys={[key()]} canCreate={false} />)
    expect(screen.getByRole('button', { name: 'New key' })).toBeDisabled()
    expect(screen.getByText('Your admin has turned off new personal keys.')).toBeInTheDocument()
  })

  it('opens Rename, Rotate and Revoke from the row menu', async () => {
    const user = userEvent.setup()
    wrap(<PersonalApiKeys apiKeys={[key()]} canCreate />)
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(await screen.findByText('Renaming Inbox triage script')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rotate' }))
    expect(await screen.findByText('Rotating Inbox triage script')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }))
    expect(await screen.findByText('Revoking Inbox triage script')).toBeInTheDocument()
  })
})

describe('PersonalApiKeys expired keys', () => {
  it('marks an expired key and offers only Revoke', async () => {
    const user = userEvent.setup()
    wrap(<PersonalApiKeys apiKeys={[key({ expiresAt: new Date('2026-01-01') })]} canCreate />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Revoke'])
  })

  it('reads its scope summary from the page catalogue', () => {
    render(
      <IntlProvider
        locale="de"
        messages={{
          'portal.settings.apiKeys.summary.readWrite': '{domain} (Lesen und Schreiben)',
          'portal.settings.apiKeys.scope.chat': 'Unterhaltungen',
        }}
      >
        <QueryClientProvider client={new QueryClient()}>
          <PersonalApiKeys apiKeys={[key()]} canCreate />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(screen.getByText('Unterhaltungen (Lesen und Schreiben)')).toBeInTheDocument()
  })
})

describe('CreatePersonalKeyDialog', () => {
  it('creates a key that expires in 90 days by default', async () => {
    createMine.mockResolvedValue({
      ok: true,
      apiKey: key({ name: 'Laptop' }),
      plainTextKey: 'qb_secret',
    })
    const onKeyCreated = vi.fn()
    wrap(<CreatePersonalKeyDialog open onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />)
    expect(screen.getAllByText('Keys act as you. They can see and do what you can.').length).toBe(1)
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    expect(createMine.mock.calls[0][0].data).toMatchObject({ name: 'Laptop', expiry: '90d' })
  })

  it('offers 30 days, 1 year and No expiry', async () => {
    createMine.mockResolvedValue({ ok: true, apiKey: key(), plainTextKey: 'qb_secret' })
    const onKeyCreated = vi.fn()
    wrap(<CreatePersonalKeyDialog open onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />)
    for (const label of ['30 days', '1 year', 'No expiry'])
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'No expiry' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    expect(createMine.mock.calls[0][0].data.expiry).toBe('never')
  })

  it('labels the scope picker from the page catalogue', () => {
    render(
      <IntlProvider
        locale="de"
        messages={{
          'portal.settings.apiKeys.scope.feedback': 'Feedback DE',
          'portal.settings.apiKeys.scope.read': 'Lesen',
        }}
      >
        <QueryClientProvider client={new QueryClient()}>
          <CreatePersonalKeyDialog open onOpenChange={vi.fn()} onKeyCreated={vi.fn()} />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(screen.getByText('Feedback DE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Feedback DE: Lesen' })).toBeInTheDocument()
  })

  it('shows a refusal in catalogue words, not the server text', async () => {
    createMine.mockResolvedValue({
      ok: false,
      code: 'POLICY_OFF',
      message: 'server text',
    })
    const onKeyCreated = vi.fn()
    wrap(<CreatePersonalKeyDialog open onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off new personal keys')
    expect(onKeyCreated).not.toHaveBeenCalled()
  })
})
