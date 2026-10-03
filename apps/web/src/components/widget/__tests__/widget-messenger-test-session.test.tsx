// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  testSession: false,
  emitEvent: vi.fn(),
  started: null as null | ((id: string) => void),
}))
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: null,
    ensureSession: async () => true,
    sessionVersion: 0,
    testSession: state.testSession,
    emitEvent: state.emitEvent,
  }),
}))
vi.mock('@/components/shared/conversation/visitor-conversation-thread', () => ({
  VisitorConversationThread: (props: { onConversationStarted?: (id: string) => void }) => {
    state.started = props.onConversationStarted ?? null
    return null
  },
}))
vi.mock('../use-messenger-presence', () => ({
  useConversationPresence: () => null,
  markAgentPresentInCache: () => {},
}))
vi.mock('../use-widget-file-upload', () => ({ useWidgetFileUpload: () => ({ upload: vi.fn() }) }))

import { WidgetMessenger } from '../widget-messenger'

beforeEach(() => {
  state.emitEvent.mockReset()
  state.started = null
})
afterEach(cleanup)

function renderMessenger() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetMessenger />
    </QueryClientProvider>
  )
}

it('tells a test frame which conversation its first message opened', () => {
  state.testSession = true
  renderMessenger()
  state.started?.('conversation_01kw8qxn1eeh4t2rek7varh032')
  expect(state.emitEvent).toHaveBeenCalledExactlyOnceWith('conversation:started', {
    id: 'conversation_01kw8qxn1eeh4t2rek7varh032',
  })
})

it('keeps the event to test sessions, so a customer site never receives it', () => {
  state.testSession = false
  renderMessenger()
  state.started?.('conversation_01kw8qxn1eeh4t2rek7varh032')
  expect(state.emitEvent).not.toHaveBeenCalled()
})
