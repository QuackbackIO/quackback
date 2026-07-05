// @vitest-environment happy-dom
/**
 * Smoke coverage for the guidance rules card: renders a row per rule from
 * listGuidanceRulesFn, shows the surface scope, and reflects the enabled
 * state on the toggle.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const FIXTURE_RULES = [
  {
    id: 'assistant_guidance_1',
    title: 'Refund policy',
    body: 'Always mention our 30-day refund policy.',
    enabled: true,
    surfaces: null,
    category: 'content_sources',
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
    category: 'communication_style',
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

const mockGetGuidanceRuleStatsFn = vi.fn(async () => ({
  assistant_guidance_1: { used: 12, resolved: 9, resolvedPct: 75 },
  // assistant_guidance_2 has no stats row — the "no data yet" placeholder path.
}))
vi.mock('@/lib/server/functions/assistant-guidance-stats', () => ({
  getGuidanceRuleStatsFn: () => mockGetGuidanceRuleStatsFn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

// Radix Select relies on pointer-capture/scrollIntoView APIs jsdom/happy-dom
// don't implement; swap in the shared native-select test double so the
// category picker can be exercised with a plain change event.
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

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
    expect(
      await screen.findByText(/\/ 4000 characters used across enabled rules/)
    ).toBeInTheDocument()
  })
})

describe('per-rule effectiveness stats', () => {
  it('shows the used count and resolved % for a rule with stats', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Refund policy')
    expect(await screen.findByText('12 used')).toBeInTheDocument()
    expect(await screen.findByText('75% resolved')).toBeInTheDocument()
  })

  it('shows the placeholder for a rule with no stats yet', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Widget tone')
    expect(await screen.findByText('— used')).toBeInTheDocument()
    expect(await screen.findByText('— resolved')).toBeInTheDocument()
  })
})

describe('category grouping', () => {
  it('renders a section for every category in catalogue order', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Refund policy')
    expect(screen.getByText('Communication style')).toBeInTheDocument()
    expect(screen.getByText('Context and clarification')).toBeInTheDocument()
    expect(screen.getByText('Content and sources')).toBeInTheDocument()
    expect(screen.getByText('Spam')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('places each rule under its own category section', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Refund policy')

    expect(
      within(screen.getByTestId('guidance-category-content_sources')).getByText('Refund policy')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('guidance-category-communication_style')).getByText('Widget tone')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('guidance-category-communication_style')).queryByText(
        'Refund policy'
      )
    ).not.toBeInTheDocument()
  })

  it('shows an empty hint for a category with no rules', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Refund policy')

    expect(
      within(screen.getByTestId('guidance-category-spam')).getByText(
        'No rules in this category yet.'
      )
    ).toBeInTheDocument()
  })

  it('pre-selects the section\'s category when its "+ New" button is clicked', async () => {
    renderWithClient(<GuidanceRulesCard />)
    await screen.findByText('Refund policy')

    fireEvent.click(
      within(screen.getByTestId('guidance-category-spam')).getByRole('button', { name: /New/i })
    )

    expect(await screen.findByLabelText('Category')).toHaveValue('spam')
  })
})
