/**
 * The paused custom domain middleware runs on every request, right after
 * workspace resolution: its decision reads settings that need the scope.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createStart: (build: () => unknown) => build(),
}))

import { startInstance } from '../start'
import { workspaceContextMiddleware } from '@/lib/server/middleware/workspace-context'
import { pausedCustomDomainMiddleware } from '@/lib/server/middleware/paused-custom-domain'

describe('request middleware order', () => {
  it('registers the paused custom domain middleware right after workspace resolution', () => {
    const list = (startInstance as unknown as { requestMiddleware: unknown[] }).requestMiddleware
    const workspace = list.indexOf(workspaceContextMiddleware)
    expect(workspace).toBeGreaterThanOrEqual(0)
    expect(list.indexOf(pausedCustomDomainMiddleware)).toBe(workspace + 1)
  })
})
