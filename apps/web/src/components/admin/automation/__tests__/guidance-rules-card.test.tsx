// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const rules = [
  {
    id: 'assistant_guidance_1',
    name: 'Refund policy',
    appliesWhen: 'When a customer asks for a refund',
    instruction: 'Explain the 30-day policy.',
    agent: 'agent',
    enabled: true,
    priority: 0,
    createdById: null,
    createdAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
  },
  {
    id: 'assistant_guidance_2',
    name: 'Always be clear',
    appliesWhen: null,
    instruction: 'State the next step.',
    agent: 'agent',
    enabled: false,
    priority: 1,
    createdById: null,
    createdAt: new Date('2026-07-02'),
    updatedAt: new Date('2026-07-02'),
  },
  {
    id: 'assistant_guidance_3',
    name: 'Copilot only note',
    appliesWhen: null,
    instruction: 'Summarize for the teammate.',
    agent: 'copilot',
    enabled: true,
    priority: 2,
    createdById: null,
    createdAt: new Date('2026-07-03'),
    updatedAt: new Date('2026-07-03'),
  },
]
let guidanceCharBudget = 4000
const createGuidanceRule = vi.fn()
const reorderGuidanceRules = vi.fn()
const deleteGuidanceRule = vi.fn()

// Drag gestures need layout, which happy-dom lacks: capture the drag-end handler
// the card gives the DndContext and call it with a real event shape.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((event: DragEndEvent) => void) | null }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (event: DragEndEvent) => void; children: never }) => {
      dnd.onDragEnd = props.onDragEnd ?? null
      return <actual.DndContext {...props} />
    },
  }
})

vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  listGuidanceRulesFn: vi.fn(async () => ({ rules, charBudget: guidanceCharBudget })),
  createGuidanceRuleFn: (input: { data: unknown }) => createGuidanceRule(input),
  updateGuidanceRuleFn: vi.fn(),
  deleteGuidanceRuleFn: (input: { data: unknown }) => deleteGuidanceRule(input),
  reorderGuidanceRulesFn: (input: { data: unknown }) => reorderGuidanceRules(input),
  listAssistantToolsFn: vi.fn(),
}))
// Radix Select relies on pointer/layout APIs happy-dom lacks; render it as a
// native <select> so the "Applies to" picker is drivable with fireEvent.change.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) => (
    <select aria-label="Applies to" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))
vi.mock('@/lib/server/functions/assistant-guidance-stats', () => ({
  getGuidanceRuleStatsFn: vi.fn(async () => ({
    assistant_guidance_1: { applied: 12, lastAppliedAt: new Date('2026-07-10T10:00:00Z') },
    assistant_guidance_2: { applied: 1, lastAppliedAt: new Date('2026-07-11T10:00:00Z') },
  })),
}))

import { GuidanceRulesCard, guidanceRuleMatchesQuery } from '../guidance-rules-card'

afterEach(() => {
  cleanup()
  guidanceCharBudget = 4000
  createGuidanceRule.mockReset()
  reorderGuidanceRules.mockReset()
  deleteGuidanceRule.mockReset()
  dnd.onDragEnd = null
})

function renderCard(agent: 'agent' | 'copilot' = 'agent') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <GuidanceRulesCard agent={agent} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('guidanceRuleMatchesQuery', () => {
  const rule = {
    name: 'Refund policy',
    appliesWhen: 'When cancelling',
    instruction: 'Explain 30 days',
  } as never
  it('searches name, condition, and instruction', () => {
    expect(guidanceRuleMatchesQuery(rule, 'refund')).toBe(true)
    expect(guidanceRuleMatchesQuery(rule, 'cancelling')).toBe(true)
    expect(guidanceRuleMatchesQuery(rule, '30 days')).toBe(true)
    expect(guidanceRuleMatchesQuery(rule, 'billing owner')).toBe(false)
  })
})

describe('GuidanceRulesCard', () => {
  it('shows conditional versus always-on guidance and honest application stats', async () => {
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Situational guidance' })).toBeInTheDocument()
    expect(await screen.findByText('Refund policy')).toBeInTheDocument()
    expect(screen.getByText('Conditional')).toBeInTheDocument()
    expect(screen.getByText('Always on')).toBeInTheDocument()
    expect(screen.getByText('Applied 12 times')).toBeInTheDocument()
    expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument()
  })

  it('scopes the list to the card’s agent', async () => {
    renderCard('agent')
    expect(await screen.findByText('Refund policy')).toBeInTheDocument()
    // A copilot-owned rule never appears on the Agent page.
    expect(screen.queryByText('Copilot only note')).not.toBeInTheDocument()
  })

  it('shows only the copilot rule on the Copilot page', async () => {
    renderCard('copilot')
    expect(await screen.findByText('Copilot only note')).toBeInTheDocument()
    expect(screen.queryByText('Refund policy')).not.toBeInTheDocument()
  })

  it('keeps row actions in a menu and filters V2 fields', async () => {
    renderCard()
    await screen.findByText('Refund policy')
    // No always-visible icon buttons: edit and delete live in the row menu.
    expect(screen.queryByRole('button', { name: 'Edit Refund policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Refund policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Move Refund policy/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Refund policy' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search guidance...'), {
      target: { value: 'next step' },
    })
    expect(screen.getByText('Always be clear')).toBeInTheDocument()
    expect(screen.queryByText('Refund policy')).not.toBeInTheDocument()
  })

  it('edits and deletes from the row menu, deleting only after a confirm', async () => {
    deleteGuidanceRule.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderCard()
    await screen.findByText('Refund policy')
    await user.click(screen.getByRole('button', { name: 'Actions for Refund policy' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText('Delete guidance?')).toBeInTheDocument()
    expect(deleteGuidanceRule).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete guidance' }))
    await waitFor(() => expect(deleteGuidanceRule).toHaveBeenCalledTimes(1))
    expect(deleteGuidanceRule.mock.calls[0][0].data).toEqual({ id: 'assistant_guidance_1' })
    await waitFor(() => expect(screen.queryByText('Refund policy')).not.toBeInTheDocument())
  })

  it('reorders by drag within the card’s agent and saves the new order', async () => {
    reorderGuidanceRules.mockResolvedValue(undefined)
    renderCard()
    await screen.findByText('Refund policy')
    dnd.onDragEnd?.({
      active: { id: 'assistant_guidance_2' },
      over: { id: 'assistant_guidance_1' },
    } as DragEndEvent)
    await waitFor(() => expect(reorderGuidanceRules).toHaveBeenCalledTimes(1))
    expect(reorderGuidanceRules.mock.calls[0][0].data).toEqual({
      ids: ['assistant_guidance_2', 'assistant_guidance_1'],
    })
    const names = screen
      .getAllByText(/^(Refund policy|Always be clear)$/)
      .map((node) => node.textContent)
    expect(names).toEqual(['Always be clear', 'Refund policy'])
  })

  it('does not reorder while a search is active', async () => {
    renderCard()
    await screen.findByText('Refund policy')
    fireEvent.change(screen.getByPlaceholderText('Search guidance...'), { target: { value: 'e' } })
    dnd.onDragEnd?.({
      active: { id: 'assistant_guidance_2' },
      over: { id: 'assistant_guidance_1' },
    } as DragEndEvent)
    expect(reorderGuidanceRules).not.toHaveBeenCalled()
  })

  it('pluralises the applied count and formats the budget with the locale', async () => {
    renderCard()
    await screen.findByText('Refund policy')
    expect(screen.getByText('Applied 12 times')).toBeInTheDocument()
    expect(screen.getByText('Applied 1 time')).toBeInTheDocument()
    expect(screen.getByText(/of 4,000 characters/)).toBeInTheDocument()
  })

  it('defaults new guidance to the Agent and lets "Applies to" target the Copilot', async () => {
    createGuidanceRule.mockResolvedValue({
      id: 'assistant_guidance_new',
      name: 'Escalations',
      appliesWhen: null,
      instruction: 'Loop in a human.',
      agent: 'copilot',
      enabled: true,
      priority: 2,
      createdById: null,
      createdAt: new Date('2026-07-14'),
      updatedAt: new Date('2026-07-14'),
    })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'New guidance' }))

    // Defaults to Agent before any change.
    const appliesTo = screen.getByRole('combobox', { name: 'Applies to' })
    expect(appliesTo).toHaveValue('agent')

    fireEvent.change(screen.getByLabelText('Name this guidance'), {
      target: { value: 'Escalations' },
    })
    fireEvent.change(screen.getByLabelText('What should the AI agent do?'), {
      target: { value: 'Loop in a human.' },
    })
    fireEvent.change(appliesTo, { target: { value: 'copilot' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create guidance' }))

    await vi.waitFor(() => expect(createGuidanceRule).toHaveBeenCalledTimes(1))
    expect(createGuidanceRule.mock.calls[0][0].data.agent).toBe('copilot')
  })

  it('uses list ordering and prevents enabled guidance from exceeding the budget', async () => {
    guidanceCharBudget = 30
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'New guidance' }))

    fireEvent.change(screen.getByLabelText('Name this guidance'), {
      target: { value: 'Shipping' },
    })
    fireEvent.change(screen.getByLabelText('What should the AI agent do?'), {
      target: { value: 'Answer.' },
    })

    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create guidance' }))
    expect(
      await screen.findByText(
        'Shorten or disable guidance before saving to stay within the budget.'
      )
    ).toBeInTheDocument()
    expect(createGuidanceRule).not.toHaveBeenCalled()
  })
})
