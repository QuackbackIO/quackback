// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { DEFAULT_CONVERSATION_INACTIVITY } from '@/lib/shared/conversation-inactivity'
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => true }))
const mock = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    conversationInactivity: () => ({ queryKey: ['inactivity'], queryFn: mock.get }),
  },
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateConversationInactivity: () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: mock.save,
      onSuccess: (result) => queryClient.setQueryData(['inactivity'], result),
    })
  },
}))
import { ConversationInactivityCard } from '../conversation-inactivity-card'
function show(section: 'messenger' | 'email' | 'assistant' = 'messenger') {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ConversationInactivityCard section={section} />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.get.mockResolvedValue(structuredClone(DEFAULT_CONVERSATION_INACTIVITY))
  mock.save.mockResolvedValue({ ...structuredClone(DEFAULT_CONVERSATION_INACTIVITY), revision: 1 })
})
afterEach(cleanup)
describe('conversation behavior drafts', () => {
  it('never exposes editable defaults during loading', () => {
    mock.get.mockReturnValue(new Promise(() => {}))
    show()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByRole('switch')).toBeNull()
  })
  it('edits locally and saves only the edited section with its revision', async () => {
    show()
    const input = (await screen.findAllByLabelText('Close after'))[0]
    fireEvent.change(input, { target: { value: '45' } })
    expect(mock.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!)
    await waitFor(() => expect(mock.save).toHaveBeenCalled())
    expect(mock.save.mock.calls[0][0]).toMatchObject({
      section: 'messenger',
      revision: 0,
      policy: { closeMinutes: 45 },
    })
    expect(mock.save.mock.calls[0][0]).not.toHaveProperty('assistant')
  })
  it('keeps a failed draft and allows Cancel to restore saved values', async () => {
    mock.save.mockRejectedValue(new Error('Settings changed; reload before saving.'))
    show()
    const input = (await screen.findAllByLabelText('Close after'))[0]
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed')
    expect(input).toHaveValue(45)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!)
    expect(input).toHaveValue(30)
  })
  it('validates order inline while still allowing follow-up with auto-close off', async () => {
    show()
    const close = (await screen.findAllByLabelText('Close after'))[0]
    fireEvent.change(close, { target: { value: '10' } })
    expect(screen.getByRole('alert')).toHaveTextContent('earlier')
    expect(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!).toBeDisabled()
    fireEvent.click(screen.getAllByRole('switch', { name: 'Auto-close' })[0])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByLabelText('Follow-up after')[0]).toHaveValue(15)
    expect(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!).not.toBeDisabled()
  })
  it('shows custom workflow ownership without editable team rules', async () => {
    const saved = structuredClone(DEFAULT_CONVERSATION_INACTIVITY)
    saved.channels!.messenger = 'custom'
    saved.publishedWorkflows = [
      { id: 'workflow_example', name: 'VIP follow-up', channels: ['messenger'] },
    ]
    mock.get.mockResolvedValue(saved)
    show()
    expect((await screen.findAllByText('VIP follow-up'))[0]).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Auto-close' })).toBeNull()
    expect(screen.getAllByText(/outside these workflows/)[0]).toBeInTheDocument()
  })
  it('retains the Quinn draft while channel settings are edited and canceled', async () => {
    show()
    const inputs = await screen.findAllByLabelText('Close after')
    fireEvent.change(inputs[1], { target: { value: '20' } })
    fireEvent.change(inputs[0], { target: { value: '45' } })
    expect(inputs[1]).toHaveValue(20)
    expect(inputs[1]).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!)
    expect(inputs[1]).toHaveValue(20)
    expect(inputs[1]).not.toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0])
    await waitFor(() => expect(mock.save).toHaveBeenCalled())
    expect(mock.save.mock.calls[0][0]).toMatchObject({
      section: 'assistant',
      policy: { closeMinutes: 20 },
    })
  })
  it('shows separate Quinn chat and email clocks', async () => {
    show('assistant')
    expect(await screen.findByLabelText('Follow-up after')).toHaveValue(5)
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }))
    expect(screen.getByLabelText('Follow-up after')).toHaveValue(24)
    expect(screen.getByLabelText('Close after')).toHaveValue(72)
  })
})
