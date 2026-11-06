// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'

const { setPolicy } = vi.hoisted(() => ({ setPolicy: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('../revoke-api-key-dialog', () => ({
  RevokeApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ManagedApiKey }) =>
    open ? <p>Revoking {apiKey.name}</p> : null,
}))
vi.mock('@/lib/server/functions/api-keys', () => ({ revokeApiKeyFn: vi.fn() }))
vi.mock('@/lib/server/functions/personal-key-policy', () => ({
  setPersonalKeyPolicyFn: setPolicy,
}))

const { PersonalKeysOversight } = await import('../personal-keys-oversight')

function renderIt(apiKeys: ManagedApiKey[], policyEnabled = true) {
  return render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient()}>
        <PersonalKeysOversight apiKeys={apiKeys} policyEnabled={policyEnabled} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function key(over: Partial<ManagedApiKey> = {}): ManagedApiKey {
  return {
    id: 'api_key_1',
    name: 'Inbox triage script',
    kind: 'personal',
    keyPrefix: 'qb_51c0e2a9f',
    createdById: 'principal_ana',
    creatorName: 'Ana Lima',
    creatorIsTeammate: true,
    role: null,
    createdAt: new Date('2026-11-01'),
    lastUsedAt: null,
    expiresAt: new Date('2027-02-04T12:00:00Z'),
    scopes: ['read:chat', 'write:chat'],
    ...over,
  } as unknown as ManagedApiKey
}

describe('PersonalKeysOversight', () => {
  it('lists each personal key with its teammate, scopes, expiry and last used', () => {
    renderIt([
      key(),
      key({ id: 'api_key_2' as never, name: 'Docs import', scopes: null, expiresAt: null }),
    ])
    const row = screen.getByRole('row', { name: /Inbox triage script/ })
    expect(within(row).getByText('Ana Lima')).toBeInTheDocument()
    expect(within(row).getByText('Conversations (read and write)')).toBeInTheDocument()
    expect(within(row).getByText('Feb 4, 2027')).toBeInTheDocument()
    expect(within(row).getByText('Never')).toBeInTheDocument()
    const legacy = screen.getByRole('row', { name: /Docs import/ })
    expect(within(legacy).getByText('Full access (legacy)')).toBeInTheDocument()
    expect(within(legacy).getByText('No expiry')).toBeInTheDocument()
  })

  it('marks an expired key', () => {
    renderIt([key({ expiresAt: new Date('2026-01-01') })])
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('revokes a teammate key, and offers no rotate', async () => {
    const user = userEvent.setup()
    renderIt([key()])
    expect(screen.queryByRole('button', { name: /Rotate/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Revoke Inbox triage script' }))
    expect(await screen.findByText('Revoking Inbox triage script')).toBeInTheDocument()
  })

  it('switches the policy', async () => {
    setPolicy.mockResolvedValue({ enabled: false })
    const user = userEvent.setup()
    renderIt([], true)
    const toggle = screen.getByRole('switch', { name: 'Teammates can create personal API keys' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    await waitFor(() => expect(setPolicy).toHaveBeenCalledWith({ data: { enabled: false } }))
    expect(screen.getByText('No personal keys yet')).toBeInTheDocument()
  })
})
