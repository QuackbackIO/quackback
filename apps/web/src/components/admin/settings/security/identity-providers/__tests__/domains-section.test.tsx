// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'

const proofs = vi.hoisted(() => ({ value: {} as Record<string, string> }))

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('@/lib/server/functions/sso', () => ({
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
  getSsoDomainProofsFn: vi.fn(async () => proofs.value),
}))

const { DomainsSection } = await import('../domains-section')

function domain(id: string, name: string, verified: boolean): VerifiedDomain {
  return {
    id: `domain_${id}`,
    name,
    verificationToken: `tok-${id}`,
    verifiedAt: verified ? '2026-06-01T00:00:00.000Z' : null,
    enforced: false,
    providerId: 'idp_x' as `idp_${string}`,
    createdAt: '2026-05-01T00:00:00.000Z',
  }
}

function renderSection(domains: VerifiedDomain[], covered: Record<string, string>) {
  proofs.value = covered
  const provider = { id: 'idp_x', domains } as unknown as IdentityProvider
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DomainsSection provider={provider} disabled={false} />
    </QueryClientProvider>
  )
}

describe('<DomainsSection> with domains another proof covers', () => {
  it('shows the note instead of the TXT record for a covered pending domain', async () => {
    renderSection([domain('a', 'acme.com', false), domain('b', 'example.org', false)], {
      domain_a: 'email-sending',
    })

    expect(
      await screen.findByText('Already proven through email sending. Click Verify to use it.')
    ).toBeInTheDocument()
    // The covered domain's record is not asked for; the other one's still is.
    expect(screen.queryByText(/tok-a/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/tok-b/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(2)
  })

  it('says where a covered verified domain was proven', async () => {
    renderSection([domain('a', 'acme.com', true), domain('b', 'example.org', true)], {
      domain_a: 'email-sending',
    })

    expect(await screen.findByText('Verified through email sending')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})
