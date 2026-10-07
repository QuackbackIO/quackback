// @vitest-environment happy-dom
/**
 * The widget never renders link preview cards. The unfurl endpoint serves site
 * sessions only and refuses the widget's Bearer session, so a card here could
 * only ever produce a refused request and no preview.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const threadProps = vi.fn()

vi.mock('@/components/shared/conversation/visitor-conversation-thread', () => ({
  VisitorConversationThread: (props: Record<string, unknown>) => {
    threadProps(props)
    return null
  },
}))
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ user: null, ensureSession: vi.fn(), sessionVersion: 0 }),
}))
vi.mock('../use-messenger-presence', () => ({
  useConversationPresence: () => ({ online: false }),
  markAgentPresentInCache: vi.fn(),
}))
vi.mock('../use-widget-file-upload', () => ({ useWidgetFileUpload: () => ({ upload: vi.fn() }) }))

const { WidgetMessenger } = await import('../widget-messenger')

afterEach(cleanup)

describe('WidgetMessenger', () => {
  it('does not ask the thread for link previews, even when the workspace has them on', () => {
    // The widget route used to forward the workspace flag; cast so this keeps
    // failing if a caller ever passes it again.
    const props = { linkPreviews: true } as Record<string, unknown>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WidgetMessenger {...props} />
      </QueryClientProvider>
    )

    expect(threadProps).toHaveBeenCalled()
    expect(threadProps.mock.calls.at(-1)?.[0].linkPreviews).toBeFalsy()
  })
})
