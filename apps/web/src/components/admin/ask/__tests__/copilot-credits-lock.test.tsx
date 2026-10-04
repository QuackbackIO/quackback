// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'

const hoisted = vi.hoisted(() => ({ billing: true, canBill: true, catalogue: null as unknown }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBillingEnabled: () => hoisted.billing,
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => hoisted.canBill }))
vi.mock('@/lib/client/queries/billing', () => ({
  billingQueries: {
    catalogue: () => ({
      queryKey: ['billing', 'catalogue'],
      queryFn: async () => hoisted.catalogue,
    }),
  },
}))

import { CopilotCreditsLock } from '../copilot-credits-lock'

const catalogue = {
  aiIncludedCentsPerMonth: { free: 0, pro: 500 },
  aiTopUpPackCents: 1000,
  plans: [
    { id: 'free', name: 'Free', rank: 1, priceMonthlyCents: 0, billedPer: 'workspace' },
    { id: 'pro', name: 'Pro', rank: 2, priceMonthlyCents: 2400, billedPer: 'seat' },
  ],
}

function mount(credits: 'none' | 'used') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['billing', 'catalogue'], hoisted.catalogue)
  return render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <CopilotCreditsLock credits={credits} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  hoisted.billing = true
  hoisted.canBill = true
  hoisted.catalogue = catalogue
})
afterEach(cleanup)

describe('Copilot without credits', () => {
  it('names the plan that includes credits at its catalogue price and links to billing', () => {
    mount('none')
    expect(screen.getByText(/Your plan does not include AI credits/)).toHaveTextContent(
      'Pro includes them, from $24 per seat a month.'
    )
    const link = screen.getByRole('link', { name: 'Upgrade' })
    expect(link).toHaveAttribute('href', '/admin/settings/billing')
    expect(link).toHaveAccessibleDescription(/Pro includes them/)
  })

  it('offers more credits once this month is used up', () => {
    mount('used')
    expect(screen.getByText(/used up/)).toHaveTextContent('More credits start at $10.')
    expect(screen.getByRole('link', { name: 'Add credits' })).toBeVisible()
  })

  it('shows no price and no billing link where nothing is sold', () => {
    hoisted.billing = false
    hoisted.catalogue = null
    mount('none')
    expect(screen.queryByText(/\$/)).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('asks for an owner when this teammate cannot change billing', () => {
    hoisted.canBill = false
    mount('none')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Ask a workspace owner to add credits.')).toBeVisible()
  })
})
