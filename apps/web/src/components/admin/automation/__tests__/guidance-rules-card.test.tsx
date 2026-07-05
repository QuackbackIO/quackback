// @vitest-environment happy-dom
/**
 * Smoke coverage for the guidance rules card: renders a row per rule from
 * listGuidanceRulesFn, shows the surface scope, and reflects the enabled
 * state on the toggle.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const FIXTURE_RULES = [
  {
    id: 'assistant_guidance_1',
    title: 'Refund policy',
    body: 'Always mention our 30-day refund policy.',
    enabled: true,
    surfaces: null,
    position: 0,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'assistant_guidance_2',
    title: 'Widget tone',
    body: 'Be concise.',
    enabled: false,
    surfaces: ['widget'],
    position: 1,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  listGuidanceRulesFn: vi.fn(async () => ({ rules: FIXTURE_RULES, charBudget: 4000 })),
  createGuidanceRuleFn: vi.fn(),
  updateGuidanceRuleFn: vi.fn(),
  deleteGuidanceRuleFn: vi.fn(),
  reorderGuidanceRulesFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { GuidanceRulesCard } from '../guidance-rules-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('GuidanceRulesCard', () => {
  it('renders a row per rule from listGuidanceRulesFn', async () => {
    renderWithClient(<GuidanceRulesCard />)
    expect(await screen.findByText('Refund policy')).toBeInTheDocument()
    expect(await screen.findByText('Widget tone')).toBeInTheDocument()
  })

  it('shows the surface scope for each rule', async () => {
    renderWithClient(<GuidanceRulesCard />)
    expect(await screen.findByText('All surfaces')).toBeInTheDocument()
    expect(await screen.findByText('Messenger')).toBeInTheDocument()
  })

  it('reflects each rule enabled state on its toggle', async () => {
    renderWithClient(<GuidanceRulesCard />)
    expect(await screen.findByRole('switch', { name: 'Enable Refund policy' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Enable Widget tone' })).not.toBeChecked()
  })

  it('shows the char budget meter', async () => {
    renderWithClient(<GuidanceRulesCard />)
    expect(await screen.findByText(/\/ 4000 characters used across enabled rules/)).toBeInTheDocument()
  })
})
