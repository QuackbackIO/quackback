import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsService } from '../settings.service'
import type {
  UpdateAuthConfigInput,
  UpdatePortalConfigInput,
  BrandingConfig,
} from '../settings.types'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from '../settings.types'
import type { ServiceContext } from '../../shared/service-context'

// Mock database - must be hoisted for vi.mock to access
const mockDb = vi.hoisted(() => ({
  query: {
    settings: {
      findFirst: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
}))

vi.mock('@quackback/db', () => ({
  db: mockDb,
  eq: vi.fn((...args) => ({ eq: args })),
  settings: {
    id: 'id',
    slug: 'slug',
  },
  member: {
    userId: 'userId',
  },
}))

describe('SettingsService', () => {
  let settingsService: SettingsService
  let mockContext: ServiceContext

  beforeEach(() => {
    vi.clearAllMocks()
    settingsService = new SettingsService()

    mockContext = {
      userId: 'user_123' as `user_${string}`,
      memberId: 'member_123' as `member_${string}`,
      memberRole: 'admin',
      userName: 'Test User',
      userEmail: 'test@example.com',
    }
  })

  describe('getAuthConfig', () => {
    it('should return auth config when organization exists', async () => {
      const authConfig = {
        oauth: { google: true, github: false, microsoft: false },
        openSignup: false,
      }

      const mockOrg = {
        id: 'org-123',
        authConfig: JSON.stringify(authConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getAuthConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(true)
        expect(result.value.oauth.github).toBe(false)
        expect(result.value.oauth.microsoft).toBe(false)
      }
    })

    it('should return default config when authConfig is null', async () => {
      const mockOrg = {
        id: 'org-123',
        authConfig: null,
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getAuthConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(DEFAULT_AUTH_CONFIG)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.settings.findFirst.mockResolvedValue(null)

      const result = await settingsService.getAuthConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SETTINGS_NOT_FOUND')
      }
    })

    it('should handle database errors', async () => {
      mockDb.query.settings.findFirst.mockRejectedValue(new Error('Database error'))

      const result = await settingsService.getAuthConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })
  })

  describe('updateAuthConfig', () => {
    it('should update auth config successfully', async () => {
      const existingConfig = {
        oauth: { google: true, github: false, microsoft: false },
        openSignup: false,
      }

      const mockOrg = {
        id: 'org-123',
        authConfig: JSON.stringify(existingConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const input: UpdateAuthConfigInput = {
        oauth: { google: false },
      }

      const updatedConfig = {
        ...existingConfig,
        oauth: { ...existingConfig.oauth, google: false },
      }

      const mockUpdated = {
        id: 'org-123',
        authConfig: JSON.stringify(updatedConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await settingsService.updateAuthConfig(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(false)
      }
    })

    it('should return error when user is not owner or admin', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: UpdateAuthConfigInput = {
        oauth: { google: false },
      }

      const result = await settingsService.updateAuthConfig(input, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should allow owner to update settings', async () => {
      const ownerContext: ServiceContext = {
        ...mockContext,
        memberRole: 'owner',
      }

      const existingConfig = DEFAULT_AUTH_CONFIG

      const mockOrg = {
        id: 'org-123',
        authConfig: JSON.stringify(existingConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const input: UpdateAuthConfigInput = {
        oauth: { google: false },
      }

      const updatedConfig = {
        ...existingConfig,
        oauth: { ...existingConfig.oauth, google: false },
      }

      const mockUpdated = {
        id: 'org-123',
        authConfig: JSON.stringify(updatedConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await settingsService.updateAuthConfig(input, ownerContext)

      expect(result.success).toBe(true)
    })
  })

  describe('getPortalConfig', () => {
    it('should return portal config when organization exists', async () => {
      const portalConfig = {
        oauth: { google: false, github: true },
        features: DEFAULT_PORTAL_CONFIG.features,
      }

      const mockOrg = {
        id: 'org-123',
        portalConfig: JSON.stringify(portalConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getPortalConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(false)
        expect(result.value.oauth.github).toBe(true)
      }
    })

    it('should return default config when portalConfig is null', async () => {
      const mockOrg = {
        id: 'org-123',
        portalConfig: null,
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getPortalConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(DEFAULT_PORTAL_CONFIG)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.settings.findFirst.mockResolvedValue(null)

      const result = await settingsService.getPortalConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SETTINGS_NOT_FOUND')
      }
    })
  })

  describe('updatePortalConfig', () => {
    it('should update portal config successfully', async () => {
      const existingConfig = DEFAULT_PORTAL_CONFIG

      const mockOrg = {
        id: 'org-123',
        portalConfig: JSON.stringify(existingConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const input: UpdatePortalConfigInput = {
        oauth: { google: true },
      }

      const updatedConfig = {
        ...existingConfig,
        oauth: { ...existingConfig.oauth, google: true },
      }

      const mockUpdated = {
        id: 'org-123',
        portalConfig: JSON.stringify(updatedConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await settingsService.updatePortalConfig(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(true)
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: UpdatePortalConfigInput = {
        oauth: { google: true },
      }

      const result = await settingsService.updatePortalConfig(input, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('getBrandingConfig', () => {
    it('should return branding config when organization exists', async () => {
      const brandingConfig: BrandingConfig = {
        preset: 'default',
        light: {
          background: '#ffffff',
          foreground: '#000000',
        },
      }

      const mockOrg = {
        id: 'org-123',
        brandingConfig: JSON.stringify(brandingConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getBrandingConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.preset).toBe('default')
        expect(result.value.light?.background).toBe('#ffffff')
      }
    })

    it('should return empty config when brandingConfig is null', async () => {
      const mockOrg = {
        id: 'org-123',
        brandingConfig: null,
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getBrandingConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.settings.findFirst.mockResolvedValue(null)

      const result = await settingsService.getBrandingConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SETTINGS_NOT_FOUND')
      }
    })

    it('should handle invalid JSON gracefully', async () => {
      const mockOrg = {
        id: 'org-123',
        brandingConfig: 'invalid json{',
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getBrandingConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })
  })

  describe('updateBrandingConfig', () => {
    it('should update branding config successfully', async () => {
      const mockOrg = {
        id: 'org-123',
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const brandingConfig: BrandingConfig = {
        preset: 'ocean',
        light: {
          primary: '#0066cc',
        },
      }

      const mockUpdated = {
        id: 'org-123',
        brandingConfig: JSON.stringify(brandingConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await settingsService.updateBrandingConfig(brandingConfig, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(brandingConfig)
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const brandingConfig: BrandingConfig = {
        preset: 'ocean',
      }

      const result = await settingsService.updateBrandingConfig(brandingConfig, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('getPublicAuthConfig', () => {
    it('should return public auth config', async () => {
      const authConfig = {
        oauth: { google: true, github: false, microsoft: false },
        openSignup: true,
      }

      const mockOrg = {
        id: 'org-123',
        slug: 'acme',
        authConfig: JSON.stringify(authConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getPublicAuthConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(true)
        expect(result.value.openSignup).toBe(true)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.settings.findFirst.mockResolvedValue(null)

      const result = await settingsService.getPublicAuthConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SETTINGS_NOT_FOUND')
      }
    })
  })

  describe('getPublicPortalConfig', () => {
    it('should return public portal config', async () => {
      const portalConfig = {
        oauth: { google: false, github: true },
        features: DEFAULT_PORTAL_CONFIG.features,
      }

      const mockOrg = {
        id: 'org-123',
        slug: 'acme',
        portalConfig: JSON.stringify(portalConfig),
      }

      mockDb.query.settings.findFirst.mockResolvedValue(mockOrg)

      const result = await settingsService.getPublicPortalConfig()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(false)
        expect(result.value.oauth.github).toBe(true)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.settings.findFirst.mockResolvedValue(null)

      const result = await settingsService.getPublicPortalConfig()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SETTINGS_NOT_FOUND')
      }
    })
  })
})
