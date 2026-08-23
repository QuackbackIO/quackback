// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeNotice: () => <p>Custom domains are a Growth feature. Upgrade to Growth to enable it.</p>,
}))

const { DomainsCard, QuackbackUrlCard } = await import('../settings.domains')

const PENDING = {
  hostname: 'feedback.acme.test',
  readiness: 'pending' as const,
  isPrimary: false,
  updatedAt: '2026-08-15T12:00:00.000Z',
  cnameTarget: 'customers.quackback.co.uk',
  ownershipTxt: { name: '_cf-custom-hostname.feedback.acme.test', value: 'token-1' },
}

describe('domains card', () => {
  it('locks add on a plan without the entitlement', () => {
    render(
      <DomainsCard
        entitled={false}
        domains={[]}
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
    expect(screen.getByText(/Custom domains are a Growth feature/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Hostname')).not.toBeInTheDocument()
  })

  it('shows DNS instructions and does not print a provider id', () => {
    const refresh = vi.fn()
    render(
      <DomainsCard
        entitled
        domains={[PENDING]}
        hostname=""
        pending={false}
        error={null}
        onHostnameChange={vi.fn()}
        onAdd={vi.fn()}
        onRefresh={refresh}
        onMakePrimary={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getAllByText('feedback.acme.test').length).toBeGreaterThan(0)
    expect(screen.getByText(/customers\.quackback\.co\.uk/)).toBeInTheDocument()
    expect(screen.getByText(/_cf-custom-hostname\.feedback\.acme\.test/)).toBeInTheDocument()
    expect(screen.queryByText(/ch_/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    expect(refresh).toHaveBeenCalledWith('feedback.acme.test')
  })
})

describe('Workspace URL card', () => {
  it('does not prefill a generated host into the URL field', () => {
    render(
      <QuackbackUrlCard
        platformLabel=""
        domainSuffix="quackback.co.uk"
        pending={false}
        error={null}
        onPlatformLabelChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('')
    expect(screen.queryByDisplayValue(/ws-/)).not.toBeInTheDocument()
  })

  it('shows the suffix in the field and one save action, not preview or current lines', () => {
    const save = vi.fn()
    render(
      <QuackbackUrlCard
        platformLabel="ws-generated"
        domainSuffix="quackback.co.uk"
        pending={false}
        error={null}
        onPlatformLabelChange={vi.fn()}
        onSubmit={save}
      />
    )

    expect(screen.getByLabelText('Workspace URL')).toHaveValue('ws-generated')
    expect(screen.getByText('.quackback.co.uk')).toBeInTheDocument()
    expect(screen.queryByText(/Preview:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current:/)).not.toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(save).toHaveBeenCalledOnce()
  })
})
