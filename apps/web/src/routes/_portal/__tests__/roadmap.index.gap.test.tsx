// @vitest-environment happy-dom
/**
 * Differential-coverage test for the portal /roadmap route beforeLoad — the
 * roadmap-tab-enabled gate (redirect when disabled, pass otherwise).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
  redirect: (opts: unknown) => Object.assign(new Error('redirect'), { redirect: opts }),
}))
vi.mock('@tanstack/react-query', () => ({ useSuspenseQuery: vi.fn() }))
vi.mock('react-intl', () => ({ FormattedMessage: () => null }))
vi.mock('@/components/public/roadmap-board', () => ({ RoadmapBoard: () => null }))
vi.mock('@/lib/client/queries/portal', () => ({ portalQueries: {} }))

const { Route } = await import('../roadmap.index')
const beforeLoad = (
  Route as unknown as { options: { beforeLoad: (a: { context: unknown }) => Promise<void> } }
).options.beforeLoad

describe('roadmap.index beforeLoad', () => {
  it('redirects when the roadmap tab is disabled', async () => {
    await expect(beforeLoad({ context: { enabledTabs: { roadmap: false } } })).rejects.toThrow(
      'redirect'
    )
  })
  it('passes when the tab is enabled or unset', async () => {
    await expect(beforeLoad({ context: { enabledTabs: {} } })).resolves.toBeUndefined()
    await expect(beforeLoad({ context: {} })).resolves.toBeUndefined()
  })
})
