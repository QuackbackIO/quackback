// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const listMacros = vi.fn()
const deleteMacro = vi.fn()

vi.mock('@/lib/server/functions/macros', () => ({
  listMacrosFn: (...args: unknown[]) => listMacros(...args),
  createMacroFn: vi.fn(),
  updateMacroFn: vi.fn(),
  deleteMacroFn: (...args: unknown[]) => deleteMacro(...args),
}))
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/client/hooks/use-team-members', () => ({
  useTeamMembers: () => ({ data: [] }),
}))
vi.mock('@/components/admin/conversation/inbox-nav-sidebar', () => ({
  useInboxTeams: () => ({ data: [] }),
}))
vi.mock('@/lib/client/queries/conversation-attributes', () => ({
  conversationAttributeQueries: {
    live: () => ({ queryKey: ['attrs'], queryFn: async () => [] }),
  },
}))

const { MacrosManager } = await import('../macros-manager')

const MACRO = {
  id: 'macro_1',
  name: 'Password reset',
  body: 'Hi {firstName}',
  scope: 'support',
  actions: [],
}

function renderManager(
  props: { creating?: boolean; onCreatingChange?: (v: boolean) => void } = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MacrosManager
        creating={props.creating ?? false}
        onCreatingChange={props.onCreatingChange ?? (() => {})}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MacrosManager', () => {
  it('shows the shared empty state and no second create button when there are no macros', async () => {
    listMacros.mockResolvedValue({ macros: [] })
    renderManager()
    expect(await screen.findByText('No macros yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add macro|new macro/i })).toBeNull()
  })

  it('does not nest the actions menu inside a button row; Edit opens the dialog', async () => {
    listMacros.mockResolvedValue({ macros: [MACRO] })
    const user = userEvent.setup()
    const { container } = renderManager()
    await user.click(await screen.findByRole('button', { name: 'Actions for Password reset' }))
    expect(container.querySelector('[role="button"] button')).toBeNull()
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit macro' })).toBeTruthy()
  })

  it('opens the create dialog when the page asks for a new macro', async () => {
    listMacros.mockResolvedValue({ macros: [] })
    renderManager({ creating: true })
    expect(await screen.findByRole('heading', { name: 'New macro' })).toBeTruthy()
  })

  it('asks before deleting a macro and only deletes on confirm', async () => {
    listMacros.mockResolvedValue({ macros: [MACRO] })
    deleteMacro.mockResolvedValue({})
    const user = userEvent.setup()
    renderManager()
    await user.click(await screen.findByRole('button', { name: 'Actions for Password reset' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(deleteMacro).not.toHaveBeenCalled()
    expect(await screen.findByText('Delete macro?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete macro' }))
    await waitFor(() => expect(deleteMacro).toHaveBeenCalledTimes(1))
    expect(deleteMacro).toHaveBeenCalledWith({ data: { id: 'macro_1' } })
  })
})
