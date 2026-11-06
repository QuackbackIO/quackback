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

  it('opens Rotate and Revoke from the row menu', async () => {
    const user = userEvent.setup()
    wrap(<PersonalApiKeys apiKeys={[key()]} canCreate />)
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rotate' }))
    expect(screen.getByText('Rotating Inbox triage script')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for Inbox triage script' }))
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }))
    expect(screen.getByText('Revoking Inbox triage script')).toBeInTheDocument()
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

  it('shows a refusal', async () => {
    createMine.mockResolvedValue({
      ok: false,
      code: 'POLICY_OFF',
      message: 'Your admin has turned off new personal keys.',
    })
    const onKeyCreated = vi.fn()
    wrap(<CreatePersonalKeyDialog open onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off new personal keys')
    expect(onKeyCreated).not.toHaveBeenCalled()
  })
})
