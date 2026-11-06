// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DnsRecordTable, txtParts } from '../dns-record-table'

describe('<DnsRecordTable>', () => {
  it('shows each record with its state and says how to fix only the broken one', () => {
    render(
      <DnsRecordTable
        records={[
          {
            label: 'Routing',
            type: 'CNAME',
            name: 'help.acme.com',
            value: 'app.example.com',
            state: 'found',
            problem: 'not shown while found',
          },
          {
            label: 'Ownership',
            type: 'TXT',
            name: '_quackback-verify.acme.com',
            value: 'qb-domain-verify=abc',
            state: 'problem',
            problem: 'Replace it with the value above.',
          },
          {
            label: 'DKIM',
            type: 'TXT',
            name: 'qb._domainkey',
            value: 'v=DKIM1; p=xyz',
            state: 'waiting',
          },
        ]}
      />
    )

    const rows = document.querySelectorAll('[data-slot="dns-record"]')
    expect([...rows].map((r) => r.textContent)).toEqual([
      'Found: Routinghelp.acme.comCNAMEapp.example.com',
      'Needs a fix: Ownership_quackback-verify.acme.comTXTqb-domain-verify=abc',
      'Waiting: DKIMqb._domainkeyTXTv=DKIM1; p=xyz',
    ])
    const fixes = document.querySelectorAll('[data-slot="dns-record-fix"]')
    expect([...fixes].map((r) => r.textContent)).toEqual(['Replace it with the value above.'])
    expect(screen.getByRole('button', { name: 'Copy value for help.acme.com' })).toBeInTheDocument()
  })
})

describe('<DnsRecordTable> layout', () => {
  it('keeps a name on one line and lets a long value wrap anywhere', () => {
    render(
      <DnsRecordTable
        records={[
          {
            label: 'DKIM',
            type: 'TXT',
            name: 'qb-20261103._domainkey',
            value: `v=DKIM1; k=rsa; p=${'A'.repeat(300)}`,
            state: 'waiting',
          },
        ]}
      />
    )
    expect(screen.getByText('qb-20261103._domainkey')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('qb-20261103._domainkey')).not.toHaveClass('break-all')
    expect(screen.getByText(/^v=DKIM1/)).toHaveClass('break-all')
    expect(screen.getByText('TXT').closest('td')).toHaveClass('whitespace-nowrap')
    expect(document.querySelector('table')!.parentElement).toHaveClass('overflow-x-auto')
  })
})

describe('<DnsRecordTable> a value longer than one TXT string', () => {
  const LONG = `v=DKIM1; k=rsa; p=${'A'.repeat(300)}${'B'.repeat(92)}`

  it('splits a value into quoted parts of at most 255 characters', () => {
    expect(LONG).toHaveLength(410)
    expect(txtParts(LONG)).toBe(`"${LONG.slice(0, 255)}" "${LONG.slice(255)}"`)
    expect(txtParts('x'.repeat(600))).toBe(
      `"${'x'.repeat(255)}" "${'x'.repeat(255)}" "${'x'.repeat(90)}"`
    )
  })

  it('shows the whole value, copies it whole, and offers it as parts once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(
      <DnsRecordTable
        records={[
          { label: 'DKIM', type: 'TXT', name: 'qb1._domainkey', value: LONG, state: 'waiting' },
          {
            label: 'Return path',
            type: 'TXT',
            name: 'qb-bounce',
            value: 'v=spf1 ~all',
            state: 'found',
          },
        ]}
      />
    )
    expect(screen.getByText(LONG)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy value for qb1._domainkey' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(LONG))

    const parts = screen.getAllByRole('button', { name: /copy as parts/i })
    expect(parts).toHaveLength(1)
    fireEvent.click(parts[0])
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(`"${LONG.slice(0, 255)}" "${LONG.slice(255)}"`)
    )
  })
})
