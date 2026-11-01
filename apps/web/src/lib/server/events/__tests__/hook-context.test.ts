/**
 * The hook context carries the portal's word for what visitors post, read as
 * the portal reads it, so emails name it the same way. An email still goes
 * out, saying idea, if the design cannot be read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ settings: vi.fn(), warn: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ name: 'Acme', logoKey: null }) } } },
}))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => 'https://acme.example.com' }))
vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: hoisted.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.settings,
}))

const { buildHookContext } = await import('../hook-context')

beforeEach(() => {
  hoisted.settings.mockReset()
  hoisted.warn.mockReset()
})

describe('buildHookContext', () => {
  it('carries the published design’s word', async () => {
    hoisted.settings.mockResolvedValue({
      portalDesign: { engine: 'v2', vocabulary: { post: 'suggestion', board: 'category' } },
    })
    expect(await buildHookContext()).toMatchObject({
      workspaceName: 'Acme',
      postWord: 'suggestion',
    })
  })

  it('says idea on the legacy theme, or when the design cannot be read', async () => {
    hoisted.settings.mockResolvedValue({ portalDesign: { engine: 'legacy' } })
    expect((await buildHookContext())?.postWord).toBe('idea')
    expect(hoisted.warn).not.toHaveBeenCalled()
    hoisted.settings.mockRejectedValue(new Error('cache down'))
    expect((await buildHookContext())?.postWord).toBe('idea')
    expect(hoisted.warn).toHaveBeenCalledTimes(1)
  })
})
