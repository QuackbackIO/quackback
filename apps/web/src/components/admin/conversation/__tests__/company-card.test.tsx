// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

afterEach(cleanup)

const hoisted = vi.hoisted(() => ({
  permissions: ['company.view'] as string[],
  getCompanyForPrincipalFn: vi.fn(),
  qualifyCompanyFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/companies', () => ({
  getCompanyForPrincipalFn: hoisted.getCompanyForPrincipalFn,
  qualifyCompanyFn: hoisted.qualifyCompanyFn,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useRouteContext: (opts?: { select?: (context: unknown) => unknown }) => {
    const context = { permissions: hoisted.permissions }
    return opts?.select ? opts.select(context) : context
  },
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
  hoisted.permissions = ['company.view']
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

  it('stays hidden and asks nothing for a viewer without company.view', async () => {
    hoisted.permissions = ['conversation.view', 'conversation.reply']
    const { container } = renderCard()

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(hoisted.getCompanyForPrincipalFn).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
