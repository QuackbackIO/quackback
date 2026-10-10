// @vitest-environment happy-dom
import { MENU_LABEL } from '@/components/ui/menu'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CompaniesView } from '../companies-view'
import type { CompanyWithMemberCountDTO } from '@/lib/server/functions/companies'

afterEach(cleanup)

function company(
  id: string,
  name: string,
  over: Partial<CompanyWithMemberCountDTO> = {}
): CompanyWithMemberCountDTO {
  return {
    id,
    name,
    domain: null,
    externalId: null,
    plan: null,
    mrrCents: null,
    size: null,
    website: null,
    industry: null,
    source: 'manual',
    customAttributes: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    memberCount: 1,
    ...over,
  } as CompanyWithMemberCountDTO
}

function renderView(companies: CompanyWithMemberCountDTO[]) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CompaniesView
        companies={companies}
        isLoading={false}
        onSearchChange={() => {}}
        onCompanyAttrsChange={() => {}}
        onSelectCompany={() => {}}
        canManage
      />
    </QueryClientProvider>
  )
}

const ROWS = [
  company('c1', 'Alpha', { mrrCents: 10000, memberCount: 20 }),
  company('c2', 'Bravo', { mrrCents: 50000, memberCount: 9, source: 'api' }),
  company('c3', 'Charlie', { mrrCents: 20000, memberCount: 5 }),
]

describe('<CompaniesView> toolbar', () => {
  it('puts Filter on the toolbar row before the actions, with no Sort and no Add filter line', () => {
    renderView(ROWS)
    const toolbar = document.querySelector('[data-slot="admin-list-search"]')!.parentElement!
    const labels = Array.from(toolbar.querySelectorAll('button, a')).map((b) =>
      b.textContent?.trim()
    )
    expect(labels).toEqual(['Filter', 'Export CSV', 'New company'])
    expect(screen.queryByText('Add filter')).toBeNull()
    expect(screen.queryByRole('button', { name: /Sort/ })).toBeNull()
  })
})

describe('<CompaniesView> table', () => {
  it('uses the same header style as the users list', () => {
    renderView(ROWS)
    for (const header of ['Company', 'Plan', 'Monthly spend', 'Users', 'Source']) {
      const el = screen.getByText(header, { selector: 'span' })
      expect(el.className).toContain(MENU_LABEL)
    }
  })

  it('shows no source token for the default source and a token for the others', () => {
    renderView(ROWS)
    expect(screen.queryByText(/^manual$/i)).toBeNull()
    expect(screen.getByText(/^api$/i)).toBeInTheDocument()
    expect(within(document.body).getAllByText(/^api$/i)).toHaveLength(1)
  })
})
