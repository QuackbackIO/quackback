// @vitest-environment happy-dom
/**
 * An email a visitor gives inside the messenger (the in-thread ticket form)
 * reaches the host page as the SDK's `email-submitted` event.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const threadProps = vi.fn()
const emitEvent = vi.fn()

vi.mock('@/components/shared/conversation/visitor-conversation-thread', () => ({
  VisitorConversationThread: (props: Record<string, unknown>) => {
    threadProps(props)
    return null
  },
}))
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ user: null, ensureSession: vi.fn(), sessionVersion: 0, emitEvent }),
}))
vi.mock('../use-messenger-presence', () => ({
  useConversationPresence: () => ({ online: false }),
  markAgentPresentInCache: vi.fn(),
}))
vi.mock('../use-widget-file-upload', () => ({ useWidgetFileUpload: () => ({ upload: vi.fn() }) }))

const { WidgetMessenger } = await import('../widget-messenger')

afterEach(cleanup)

describe('WidgetMessenger email-submitted', () => {
  it('emits email-submitted to the host when the thread reports a submitted email', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WidgetMessenger />
      </QueryClientProvider>
    )

    const onEmailSubmitted = threadProps.mock.calls.at(-1)?.[0].onEmailSubmitted
    expect(onEmailSubmitted).toBeTypeOf('function')
    onEmailSubmitted('sam@example.com')
    expect(emitEvent).toHaveBeenCalledWith('email-submitted', { email: 'sam@example.com' })
  })
})
