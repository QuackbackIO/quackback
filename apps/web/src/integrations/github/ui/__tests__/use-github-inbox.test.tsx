// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
const inbox = vi.fn()
vi.mock('@/integrations/github/server/functions', () => ({
  setGitHubInboxEnabledFn: (...a: unknown[]) => inbox(...a),
  getGitHubChannelStatusFn: vi.fn(),
}))

const { useSetGitHubInbox } = await import('../use-github-inbox')
const { createAutosaveMutationCache } = await import('@/lib/client/autosave')

function setup() {
  const client = new QueryClient({ mutationCache: createAutosaveMutationCache() })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(useSetGitHubInbox, { wrapper })
}

describe('useSetGitHubInbox', () => {
  it('sends the switch value', async () => {
    inbox.mockResolvedValueOnce({ ok: true })
    const { result } = setup()
    await act(() => result.current.mutateAsync(true))
    expect(inbox).toHaveBeenCalledWith({ data: { enabled: true } })
  })

  it('names the server reason when the switch is refused', async () => {
    inbox.mockRejectedValueOnce(new Error('Resume GitHub before enabling the inbox channel.'))
    const { result } = setup()
    await act(() => result.current.mutateAsync(true).catch(() => undefined))
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't save. Resume GitHub before enabling the inbox channel."
      )
    )
  })
})
