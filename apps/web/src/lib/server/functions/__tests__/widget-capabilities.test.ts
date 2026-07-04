/**
 * getWidgetCapabilitiesFn is the public boot handshake. It must reflect the
 * deployment's configured chat transport verbatim (so an operator behind an
 * SSE-hostile proxy can force polling) and always carry a poll cadence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfig = { chatTransportMode: 'live' as 'live' | 'poll' }
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

// The real createServerFn wraps the handler in an RPC entry that needs a request
// context; return the raw handler so it's directly callable in this unit test.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
}))

import { getWidgetCapabilitiesFn } from '../widget-capabilities'

beforeEach(() => {
  mockConfig.chatTransportMode = 'live'
})

describe('getWidgetCapabilitiesFn', () => {
  it('reports live transport by default with a poll cadence', async () => {
    const caps = await getWidgetCapabilitiesFn()
    expect(caps.chat.mode).toBe('live')
    expect(caps.chat.pollIntervalMs).toBeGreaterThan(0)
  })

  it('reports poll transport when the deployment forces it', async () => {
    mockConfig.chatTransportMode = 'poll'
    const caps = await getWidgetCapabilitiesFn()
    expect(caps.chat.mode).toBe('poll')
  })
})
