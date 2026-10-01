// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

let skills: Array<Record<string, unknown>> = []
const updateSkill = vi.fn()

vi.mock('@/lib/server/functions/assistant-skills', () => ({
  listSkillsFn: vi.fn(async () => ({ skills })),
  createSkillFn: vi.fn(),
  deleteSkillFn: vi.fn(),
  updateSkillFn: (input: { data: unknown }) => {
    updateSkill(input.data)
    return {}
  },
}))

const { Route } = await import('../settings.skills')
const SkillsPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component

const SKILL = {
  id: 'skill_1',
  name: 'Refund policy',
  whenToUse: 'The customer asks about a refund',
  instructions: 'Check the order date first.',
  assignments: { agent: true, copilot: false },
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <SkillsPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  skills = []
  updateSkill.mockClear()
})
afterEach(cleanup)

describe('skills page', () => {
  it('uses the standard page header, whose title has no icon beside it', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Skills' })
    const header = heading.closest('[data-page-header]')
    expect(header).not.toBeNull()
    expect(heading.previousElementSibling).toBeNull()
  })

  it('shows an empty state with the New skill button only in the header and no loading explainer', async () => {
    renderPage()
    expect(await screen.findByText('No skills yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New skill' })).toHaveLength(1)
    expect(screen.queryByText(/full instructions load only/i)).toBeNull()
  })

  it('puts the row switch after the skill name and saves a toggle', async () => {
    skills = [SKILL]
    renderPage()
    const name = await screen.findByText('Refund policy')
    const toggle = screen.getByRole('switch', { name: 'Refund policy' })
    expect(name.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(updateSkill).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'skill_1', enabled: false })
      )
    )
  })
})
