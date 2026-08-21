import { describe, it, expect, vi } from 'vitest'
import { isAuthMethodAllowed } from '../auth-restrictions'

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(),
  getPublicPortalConfig: vi.fn(),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: vi.fn(async () => true),
}))

const workspace = { authConfig: { oauth: { password: false, magicLink: true, google: true } } }
const noOidc = new Set<string>()

describe('isAuthMethodAllowed parity across roles', () => {
  for (const role of ['admin', 'user'] as const) {
    it(`role=${role} reads the single authConfig.oauth`, async () => {
      expect(
        (await isAuthMethodAllowed('credential', role, noOidc, workspace as never)).allowed
      ).toBe(false)
      expect(
        (await isAuthMethodAllowed('magic-link', role, noOidc, workspace as never)).allowed
      ).toBe(true)
      expect((await isAuthMethodAllowed('google', role, noOidc, workspace as never)).allowed).toBe(
        true
      )
    })
  }
})
