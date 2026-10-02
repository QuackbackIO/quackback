// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ApiKey } from '@/lib/shared/types'

vi.mock('../create-api-key-dialog', () => ({
  CreateApiKeyDialog: ({ open }: { open: boolean }) => (open ? <p>Create key form</p> : null),
}))
vi.mock('../api-key-reveal-dialog', () => ({ ApiKeyRevealDialog: () => null }))
vi.mock('../revoke-api-key-dialog', () => ({
  RevokeApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKey }) =>
    open ? <p>Revoking {apiKey.name}</p> : null,
}))
vi.mock('../rotate-api-key-dialog', () => ({
  RotateApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKey }) =>
    open ? <p>Rotating {apiKey.name}</p> : null,
}))

const { ApiKeysSettings } = await import('../api-keys-settings')

afterEach(cleanup)

function key(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key_1',
    name: 'Deploy key',
    keyPrefix: 'qb_abc123',
    createdAt: new Date('2026-01-01'),
    lastUsedAt: null,
    scopes: null,
    ...over,
  } as unknown as ApiKey
}

describe('ApiKeysSettings', () => {
  it('titles the card "API keys" and creates with "New API key"', () => {
    render(<ApiKeysSettings apiKeys={[key()]} />)
    expect(screen.getByRole('heading', { name: 'API keys' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New API key' }))
    expect(screen.getByText('Create key form')).toBeInTheDocument()
  })

  it('shows a compact empty state whose action is also "New API key"', () => {
    render(<ApiKeysSettings apiKeys={[]} />)
    expect(screen.getByText('No API keys yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New API key' }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Create your first/)).toBeNull()
  })

  it('keeps Rotate and Revoke in the row menu, not as always-visible buttons', async () => {
    const user = userEvent.setup()
    render(<ApiKeysSettings apiKeys={[key()]} />)
    expect(screen.queryByRole('button', { name: /Revoke Deploy key API key/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Actions for Deploy key' }))
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }))
    expect(screen.getByText('Revoking Deploy key')).toBeInTheDocument()
  })

  it('opens the rotate dialog from the row menu', async () => {
    const user = userEvent.setup()
    render(<ApiKeysSettings apiKeys={[key()]} />)
    await user.click(screen.getByRole('button', { name: 'Actions for Deploy key' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rotate' }))
    expect(screen.getByText('Rotating Deploy key')).toBeInTheDocument()
  })

  it('shows "Never used" as plain muted text in the meta line', () => {
    render(<ApiKeysSettings apiKeys={[key()]} />)
    const never = screen.getByText(/Never used/)
    expect(never.className).not.toMatch(/amber|orange/)
  })

  it('shows scopes on their own wrapping line so a long list is not cut off', () => {
    render(
      <ApiKeysSettings
        apiKeys={[
          key({ scopes: ['read:feedback', 'write:feedback'] as unknown as ApiKey['scopes'] }),
        ]}
      />
    )
    const scopes = screen.getByText(/Feedback \(read and write\)/)
    expect(scopes.className).toMatch(/whitespace-normal/)
    expect(scopes.className).not.toMatch(/truncate/)
  })
})
