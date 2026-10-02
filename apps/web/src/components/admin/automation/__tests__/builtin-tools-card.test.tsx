// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const updateToolRules = vi.fn()

const config = {
  agents: {
    agent: { toolRules: { create_ticket: 'deny' } },
    copilot: { toolRules: {} },
  },
}

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({ config, revision: 7 })),
  updateAssistantToolRulesFn: (input: { data: unknown }) => {
    updateToolRules(input.data)
    return { config, revision: 8 }
  },
}))
vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  listAssistantToolsFn: vi.fn(async () => [
    { name: 'set_attribute', label: 'Set attribute', description: 'Record a fact.', risk: 'write' },
    { name: 'create_ticket', label: 'Create ticket', description: 'Open a ticket.', risk: 'write' },
    { name: 'search', label: 'Search', description: 'Read only.', risk: 'read' },
  ]),
}))

import { BuiltInToolsCard } from '../builtin-tools-card'

afterEach(cleanup)

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <BuiltInToolsCard />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('BuiltInToolsCard', () => {
  it('is one card whose Agent / Copilot switch picks the agent being edited', async () => {
    renderCard()
    const tool = await screen.findByRole('radiogroup', { name: 'Set attribute' })
    // The agent's role default allows writes; the copilot's asks first.
    expect(within(tool).getByRole('radio', { name: 'Allow' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getAllByText('Built-in actions')).toHaveLength(1)

    await userEvent.click(screen.getByRole('radio', { name: 'Copilot' }))
    const copilotTool = screen.getByRole('radiogroup', { name: 'Set attribute' })
    expect(within(copilotTool).getByRole('radio', { name: 'Ask' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('shows the saved rule and no Default chips, and lists write tools only', async () => {
    renderCard()
    const ticket = await screen.findByRole('radiogroup', { name: 'Create ticket' })
    expect(within(ticket).getByRole('radio', { name: 'Never' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.queryByText('Default')).toBeNull()
    expect(screen.queryByText('Search')).toBeNull()
  })

  it('saves the picked policy for the selected agent under the stored rule name', async () => {
    renderCard()
    await userEvent.click(await screen.findByRole('radio', { name: 'Copilot' }))
    const tool = screen.getByRole('radiogroup', { name: 'Set attribute' })
    await userEvent.click(within(tool).getByRole('radio', { name: 'Never' }))
    await waitFor(() =>
      expect(updateToolRules).toHaveBeenCalledWith({
        expectedRevision: 7,
        agent: 'copilot',
        toolRules: { set_attribute: 'deny' },
      })
    )
  })
})
