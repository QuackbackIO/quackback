// @vitest-environment happy-dom
/**
 * A custom domain goes live only after the workspace proves it controls the
 * hostname's DNS, so the card must show both records a pending domain needs:
 * the CNAME that routes traffic and the TXT record that proves ownership.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DomainsCard } from '../domains-cards'
import type { CustomDomainInstruction } from '@/lib/server/control-plane/client'

afterEach(cleanup)

function renderCard(domains: CustomDomainInstruction[]) {
  return render(
    <DomainsCard
      entitled
      domains={domains}
      hostname=""
      pending={false}
      error={null}
      onHostnameChange={vi.fn()}
      onAdd={vi.fn()}
      onRefresh={vi.fn()}
      onMakePrimary={vi.fn()}
      onRemove={vi.fn()}
    />
  )
}

const base = {
  hostname: 'feedback.example.com',
  isPrimary: false,
  cnameTarget: 'edge.example.net',
} as const

describe('<DomainsCard>', () => {
  it('shows the ownership TXT record next to the CNAME for a pending domain', () => {
    renderCard([
      {
        ...base,
        readiness: 'pending',
        ownershipTxt: null,
        ownershipProof: {
          name: '_quackback-challenge.feedback.example.com',
          value: 'proof-token-1',
        },
      } as CustomDomainInstruction,
    ])
    expect(screen.getByText('edge.example.net')).toBeTruthy()
    expect(screen.getByText('_quackback-challenge.feedback.example.com')).toBeTruthy()
    expect(screen.getByText('proof-token-1')).toBeTruthy()
  })

  it('asks for no TXT record once ownership is proven', () => {
    renderCard([
      {
        ...base,
        readiness: 'pending',
        ownershipTxt: null,
        ownershipProof: null,
      } as CustomDomainInstruction,
    ])
    expect(screen.getByText('edge.example.net')).toBeTruthy()
    expect(screen.queryByText(/TXT record/i)).toBeNull()
  })

  it('never shows the hosting provider validation record', () => {
    renderCard([
      {
        ...base,
        readiness: 'pending',
        ownershipTxt: {
          name: '_provider-validation.feedback.example.com',
          value: 'provider-token',
        },
        ownershipProof: null,
      } as CustomDomainInstruction,
    ])
    expect(screen.queryByText(/provider-token/)).toBeNull()
    expect(screen.queryByText(/TXT record/i)).toBeNull()
  })

  it('names no hosting provider in its description', () => {
    renderCard([])
    expect(screen.queryByText(/cloud/i)).toBeNull()
    expect(screen.getByText('Point a hostname you own at this workspace.')).toBeTruthy()
  })
})
