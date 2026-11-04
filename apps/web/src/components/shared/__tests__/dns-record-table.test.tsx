// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DnsRecordTable } from '../dns-record-table'

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
            label: 'Signing',
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
      'Waiting: Signingqb._domainkeyTXTv=DKIM1; p=xyz',
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
            label: 'Signing',
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
