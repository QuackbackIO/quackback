// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspaceTransport } from '../use-workspace-transport'

const state = vi.hoisted(() => ({ hook: vi.fn(), start: vi.fn(), stop: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/client/hooks/use-agui-turn', () => ({
  useAguiTurn: (options: unknown) => {
    expect(options).toEqual({ url: '/api/admin/assistant/workspace' })
    state.hook(options)
    return { start: state.start, stop: state.stop, clear: state.clear }
  },
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function Probe() {
  const transport = useWorkspaceTransport()
  const options = {
    question: 'Turn on Messenger',
    forwardedProps: { threadKey: 'workspace:acme' },
    handlers: { onFinal: vi.fn(), onError: vi.fn() },
  }
  return (
    <>
      {transport.renderer}
      <button
        onClick={() => {
          void transport.start(options)
        }}
      >
        Ask
      </button>
      <button
        onClick={() => {
          void transport.start(options).catch((error) => {
            expect(error.name).toBe('AbortError')
            state.clear('cancelled')
          })
          transport.stop()
        }}
      >
        Cancel before loading
      </button>
    </>
  )
}

it('loads the existing streaming hook only after an explicit Ask and forwards its complete contract', async () => {
  state.start.mockImplementation(async (options: Record<string, unknown>) => {
    expect(options).toMatchObject({
      question: 'Turn on Messenger',
      forwardedProps: { threadKey: 'workspace:acme' },
    })
    expect(options.handlers).toMatchObject({
      onFinal: expect.any(Function),
      onError: expect.any(Function),
    })
  })
  render(<Probe />)
  expect(state.hook).not.toHaveBeenCalled()
  expect(state.start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1))
  expect(state.hook).toHaveBeenCalled()
})

it('cancels a queued request before the streaming client mounts', async () => {
  state.start.mockImplementation(async () => {
    throw new Error('A cancelled question cannot start')
  })
  render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel before loading' }))
  await vi.waitFor(() => expect(state.clear).toHaveBeenCalledWith('cancelled'))
  expect(state.start).not.toHaveBeenCalled()
})
