// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

afterEach(cleanup)

const hoisted = vi.hoisted(() => ({
  getCompanyForPrincipalFn: vi.fn(),
  qualifyCompanyFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/companies', () => ({
  getCompanyForPrincipalFn: hoisted.getCompanyForPrincipalFn,
  qualifyCompanyFn: hoisted.qualifyCompanyFn,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}))

import { CompanyCard } from '../company-card'

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CompanyCard principalId="principal_1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getCompanyForPrincipalFn.mockResolvedValue(null)
})

describe('<CompanyCard>', () => {
  it('keeps an empty company editor collapsed until requested', async () => {
    renderCard()

    const add = await screen.findByRole('button', { name: 'Add company' })
    expect(screen.queryByPlaceholderText('Company name')).not.toBeInTheDocument()

    fireEvent.click(add)

    expect(screen.getByPlaceholderText('Company name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Size (e.g. 11-50)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save company' })).toBeDisabled()
  })
})
