// @vitest-environment happy-dom
/**
 * A custom domain goes live only after the workspace proves it controls the
 * hostname's DNS, so the card must show both records a pending domain needs:
 * the CNAME that routes traffic and the TXT record that proves ownership.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DomainsCard } from '../domains-cards'
import { FULL_NAMES_NOTE } from '@/components/shared/dns-record-table'
import type { CustomDomainInstruction } from '@/lib/server/control-plane/client'
import type { ShownProofSource } from '@/lib/shared/domain-proof'

afterEach(cleanup)

function renderCard(domains: (CustomDomainInstruction & { provenBy?: ShownProofSource | null })[]) {
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

  it('asks for no TXT record once ownership is verified', () => {
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

  it("lists a pending hostname's records as waiting, with no fix yet", () => {
    renderCard([
      {
        ...base,
        readiness: 'pending',
        ownershipTxt: null,
        ownershipProof: { name: '_quackback-challenge.feedback.example.com', value: 'proof-1' },
      } as CustomDomainInstruction,
    ])
    const rows = [...document.querySelectorAll('[data-slot="dns-record"]')]
    expect(rows.map((r) => r.textContent)).toEqual([
      'Waiting: Routingfeedback.example.comCNAMEedge.example.net',
      'Waiting: Ownership_quackback-challenge.feedback.example.comTXTproof-1',
    ])
    expect(document.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(0)
    // The hostname's zone is not known, so names are shown in full and the card says so.
    expect(screen.getByText(FULL_NAMES_NOTE)).toBeTruthy()
  })

  it('explains a failed hostname once, under its last record', () => {
    renderCard([
      {
        ...base,
        readiness: 'failed',
        ownershipTxt: null,
        ownershipProof: { name: '_quackback-challenge.feedback.example.com', value: 'proof-1' },
      } as CustomDomainInstruction,
    ])
    const rows = [...document.querySelectorAll('[data-slot="dns-record"]')]
    expect(rows.every((r) => r.textContent?.startsWith('Needs a fix:'))).toBe(true)
    const fixes = document.querySelectorAll('[data-slot="dns-record-fix"]')
    expect(fixes).toHaveLength(1)
    expect(rows[1]!.nextElementSibling).toBe(fixes[0])
  })

  /** A pending hostname the operator still sends a challenge record for. */
  const challenged = (provenBy: ShownProofSource | null) => ({
    ...base,
    readiness: 'pending' as const,
    updatedAt: '2026-10-01T12:00:00.000Z',
    ownershipTxt: null,
    ownershipProof: { name: '_quackback-challenge.feedback.example.com', value: 'proof-1' },
    provenBy,
  })

  it('shows a covered hostname as already verified in place of the challenge record', () => {
    renderCard([challenged('email-sending')])
    const rows = [...document.querySelectorAll('[data-slot="dns-record"]')]
    expect(rows.map((r) => r.textContent)).toEqual([
      'Waiting: Routingfeedback.example.comCNAMEedge.example.net',
    ])
    expect(screen.queryByText('proof-1')).toBeNull()
    expect(screen.getByText('Already verified through email sending')).toBeTruthy()
  })

  it('says only that the workspace proved it when the viewer may not see the source', () => {
    renderCard([challenged('workspace')])
    expect(screen.getByText('Already verified by this workspace')).toBeTruthy()
    expect(screen.queryByText(/email sending|single sign-on/)).toBeNull()
    expect(screen.queryByText('proof-1')).toBeNull()
  })

  it('asks for the challenge record as before when nothing covers the hostname', () => {
    renderCard([challenged(null)])
    expect(screen.getByText('proof-1')).toBeTruthy()
    expect(screen.queryByText(/Already verified/)).toBeNull()
  })

  it('calls the card Custom domains, the field Domain and the re-check Verify', () => {
    renderCard([challenged(null)])
    expect(screen.getByText('Custom domains')).toBeTruthy()
    expect(screen.getByLabelText('Domain')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeTruthy()
    expect(screen.queryByText('Web addresses')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull()
  })

  it('says Pending while waiting and tells a failed domain to verify again', () => {
    renderCard([challenged(null)])
    expect(screen.getByText('Pending')).toBeTruthy()
    cleanup()
    renderCard([{ ...challenged(null), readiness: 'failed' }])
    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(
      screen.getByText("We couldn't confirm these records. Check each name and value, then verify.")
    ).toBeTruthy()
  })

  it('names no hosting provider in its description', () => {
    renderCard([])
    expect(screen.queryByText(/cloud/i)).toBeNull()
    expect(screen.getByText('Where people reach your portal and help center.')).toBeTruthy()
  })
})
