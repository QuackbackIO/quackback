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
      await screen.findByText('Already verified through email sending. Click Verify to use it.')
    ).toBeInTheDocument()
    // The covered domain's record is not asked for; the other one's still is.
    expect(screen.queryByText(/tok-a/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/tok-b/).length).toBeGreaterThan(0)
    expect(
      screen.getByText('Add this record to example.org, then click Verify.')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(2)
  })

  it('names no source to a viewer who cannot see it', async () => {
    renderSection([domain('a', 'acme.com', false), domain('b', 'example.org', true)], {
      domain_a: 'workspace',
      domain_b: 'workspace',
    })

    expect(
      await screen.findByText('Already verified by this workspace. Click Verify to use it.')
    ).toBeInTheDocument()
    expect(screen.getByText('Verified by this workspace')).toBeInTheDocument()
    expect(screen.queryByText(/email sending/)).not.toBeInTheDocument()
  })

  it('suggests a neutral domain in the add field', () => {
    renderSection([], {})
    expect(screen.getByPlaceholderText('example.com')).toBeInTheDocument()
  })

  it('says where a covered verified domain was verified, and nothing for a plain one', async () => {
    renderSection([domain('a', 'acme.com', true), domain('b', 'example.org', true)], {
      domain_a: 'email-sending',
    })

    expect(await screen.findByText('Verified through email sending')).toBeInTheDocument()
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })

  it('says Pending for a domain still waiting for its record', async () => {
    renderSection([domain('a', 'acme.com', false)], {})

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('Pending verification')).not.toBeInTheDocument()
  })
})

describe('ssoTxtRecord', () => {
  const pending = domain('a', 'acme.com', false)

  it('asks for the verify TXT and waits until Verify fails', async () => {
    const { ssoTxtRecord } = await import('../domains-section')
    expect(ssoTxtRecord(pending, null)).toEqual({
      label: 'Ownership',
      type: 'TXT',
      name: '_quackback-verify',
      value: 'qb-domain-verify=tok-a',
      state: 'waiting',
    })
  })

  it('carries the reason Verify failed as its problem sentence', async () => {
    const { ssoTxtRecord } = await import('../domains-section')
    const record = ssoTxtRecord(pending, { verified: false, reason: 'mismatch' })
    expect(record.state).toBe('problem')
    expect(record.problem).toMatch(/didn't match/)
  })
})
