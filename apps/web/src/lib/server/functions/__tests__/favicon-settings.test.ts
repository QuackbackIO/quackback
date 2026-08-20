/**
 * Favicon server functions — the admin upload flow ends at saveFaviconKeyFn
 * (persists the storage key) and deleteFaviconFn (clears it). Both are gated
 * on the branding permission; the portal <link rel="icon"> already reads the
 * key through WorkspaceSettings.faviconData.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSaveFaviconKey: vi.fn(),
  mockDeleteFaviconKey: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  saveFaviconKey: hoisted.mockSaveFaviconKey,
  deleteFaviconKey: hoisted.mockDeleteFaviconKey,
}))

// The mocked `.handler(fn)` returns the handler, so each export IS the
// function under test.
const { saveFaviconKeyFn, deleteFaviconFn } = await import('../settings')
const saveFaviconKey = saveFaviconKeyFn as unknown as AnyHandler
const deleteFavicon = deleteFaviconFn as unknown as AnyHandler

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.mockSaveFaviconKey.mockResolvedValue({ success: true, key: 'favicons/a.png' })
  hoisted.mockDeleteFaviconKey.mockResolvedValue({ success: true })
})

describe('saveFaviconKeyFn', () => {
  it('requires the branding permission and persists the key', async () => {
    const result = await saveFaviconKey({ data: { key: 'favicons/a.png' } })
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.SETTINGS_BRANDING,
    })
    expect(hoisted.mockSaveFaviconKey).toHaveBeenCalledWith('favicons/a.png')
    expect(result).toEqual({ success: true, key: 'favicons/a.png' })
  })

  it('does not persist anything when authorization fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Forbidden'))
    await expect(saveFaviconKey({ data: { key: 'favicons/a.png' } })).rejects.toThrow('Forbidden')
    expect(hoisted.mockSaveFaviconKey).not.toHaveBeenCalled()
  })
})

describe('deleteFaviconFn', () => {
  it('requires the branding permission and clears the key', async () => {
    const result = await deleteFavicon()
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.SETTINGS_BRANDING,
    })
    expect(hoisted.mockDeleteFaviconKey).toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })
})
