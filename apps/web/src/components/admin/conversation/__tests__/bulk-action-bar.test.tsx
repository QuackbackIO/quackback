// @vitest-environment happy-dom
/**
 * Coverage for the floating bulk-action bar's tag and macro controls: picking a
 * value from the bar reports the chosen id to the route (which fans it out over
 * the whole target set), and each control is disabled whenever the target
 * includes a ticket — tickets carry no tags and a macro reply posts a
 * conversation message, so a silent no-op would lie.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({
  fetchConversationTagsFn: vi.fn(),
  fetchTeamMembers: vi.fn(),
  listTeamsFn: vi.fn(),
  listMacrosFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsFn: hoisted.fetchConversationTagsFn,
}))
vi.mock('@/lib/server/functions/admin', () => ({
  fetchTeamMembers: hoisted.fetchTeamMembers,
}))
vi.mock('@/lib/server/functions/macros', () => ({
  listMacrosFn: hoisted.listMacrosFn,
}))
vi.mock('@/components/admin/conversation/inbox-nav-sidebar', () => ({
  useInboxTeams: () => ({ data: [] }),
}))

import { BulkActionBar } from '../bulk-action-bar'

afterEach(cleanup)

const TAGS = [
  { id: 'conversation_tag_bug', name: 'Bug', color: '#ef4444' },
  { id: 'conversation_tag_billing', name: 'Billing', color: '#3b82f6' },
]

const MACROS = [
  {
    id: 'macro_refund',
    name: 'Refund policy',
    body: 'Our refund policy is…',
    scope: 'support',
    actions: [],
  },
  {
    id: 'macro_greet',
    name: 'Greeting',
    body: 'Hi {firstName}!',
    scope: 'support',
    actions: [],
  },
]

function renderBar(props: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  hoisted.fetchConversationTagsFn.mockResolvedValue(TAGS)
  hoisted.fetchTeamMembers.mockResolvedValue([])
  hoisted.listMacrosFn.mockResolvedValue({ macros: MACROS })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <BulkActionBar
      count={3}
      solo={false}
      pending={false}
      openMenu={null}
      onOpenMenuChange={() => {}}
      onClear={() => {}}
      onAssign={() => {}}
      onAssignTeam={() => {}}
      onPriority={() => {}}
      onSnooze={() => {}}
      onTag={() => {}}
      onMacro={() => {}}
      onClose={() => {}}
      {...props}
    />
  )
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('BulkActionBar — tag control', () => {
  it('reports the picked tag id for the whole selection', async () => {
    const onTag = vi.fn()
    renderBar({ openMenu: 'tag', onTag })

    // The bar targets the multi-selection, not one thread.
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await userEvent.click(await screen.findByText('Billing'))
    expect(onTag).toHaveBeenCalledWith('conversation_tag_billing')
  })

  it('offers no tag rows when the taxonomy is empty', async () => {
    hoisted.fetchConversationTagsFn.mockResolvedValue([])
    renderBar({ openMenu: 'tag' })
    expect(await screen.findByText('No tags')).toBeInTheDocument()
  })

  it('disables the tag trigger when the target includes a ticket', async () => {
    renderBar({ disableTag: true })
    expect(screen.getByRole('button', { name: 'Tag' })).toBeDisabled()
  })
})

describe('BulkActionBar — macro control', () => {
  it('reports the picked macro id for the whole selection', async () => {
    const onMacro = vi.fn()
    renderBar({ openMenu: 'macro', onMacro })

    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await userEvent.click(await screen.findByText('Refund policy'))
    expect(onMacro).toHaveBeenCalledWith('macro_refund')
  })

  it('offers no macro rows when none exist', async () => {
    hoisted.listMacrosFn.mockResolvedValue({ macros: [] })
    renderBar({ openMenu: 'macro' })
    expect(await screen.findByText('No macros')).toBeInTheDocument()
  })

  it('disables the macro trigger when the target includes a ticket', async () => {
    renderBar({ disableMacro: true })
    expect(screen.getByRole('button', { name: 'Macro' })).toBeDisabled()
  })
})
