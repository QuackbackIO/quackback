// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const canChange = vi.hoisted(() => ({ value: true }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, hash }: { children: React.ReactNode; to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useHasPermission: () => canChange.value,
}))
vi.mock('@/lib/server/functions/channel-accounts', () => ({ getSurfaceSenderFn: vi.fn() }))

const { SurfaceSenderRow } = await import('../surface-sender-row')
const { surfaceSenderQuery } = await import('@/lib/client/queries/channel-accounts')

afterEach(() => {
  cleanup()
  canChange.value = true
})

function renderRow(from: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(surfaceSenderQuery('changelog').queryKey, { from })
  return render(
    <QueryClientProvider client={client}>
      <SurfaceSenderRow surface="changelog" />
    </QueryClientProvider>
  )
}

describe('SurfaceSenderRow', () => {
  it('says which address the email comes from', () => {
    renderRow('Acme <hello@acme.com>')
    expect(screen.getByText('Sent from')).toBeTruthy()
    expect(screen.getByText('Acme <hello@acme.com>')).toBeTruthy()
  })

  it('links an admin to the Send from card on the Email settings to change it', () => {
    renderRow('Acme <hello@acme.com>')
    expect(screen.getByRole('link', { name: 'Change' }).getAttribute('href')).toBe(
      '/admin/settings/email#send-from'
    )
  })

  it('shows the address without a link to someone who cannot change it', () => {
    canChange.value = false
    renderRow('Acme <hello@acme.com>')
    expect(screen.getByText('Acme <hello@acme.com>')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull()
  })

  it('shows nothing on an install with no address to send from', () => {
    renderRow(null)
    expect(screen.queryByText('Sent from')).toBeNull()
  })

  it('keys each kind of email apart, under the config so a change refreshes it', () => {
    expect(surfaceSenderQuery('status').queryKey).not.toEqual(
      surfaceSenderQuery('changelog').queryKey
    )
    expect(surfaceSenderQuery('status').queryKey[0]).toBe('email-channel-config')
  })
})
