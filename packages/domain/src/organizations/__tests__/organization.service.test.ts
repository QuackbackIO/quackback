import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrganizationService } from '../organization.service'
import type {
  UpdateAuthConfigInput,
  UpdatePortalConfigInput,
  BrandingConfig,
  CreateSsoProviderInput,
  UpdateSsoProviderInput,
  OidcConfig,
} from '../organization.types'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from '../organization.types'
import type { ServiceContext } from '../../shared/service-context'

// Mock database - must be hoisted for vi.mock to access
const mockDb = vi.hoisted(() => ({
  query: {
    organization: {
      findFirst: vi.fn(),
    },
    ssoProvider: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@quackback/db', () => ({
  db: mockDb,
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  desc: vi.fn((field) => ({ desc: field })),
  organization: {
    id: 'id',
    slug: 'slug',
  },
  ssoProvider: {
    id: 'id',
    organizationId: 'organizationId',
    domain: 'domain',
  },
  member: {
    userId: 'userId',
    organizationId: 'organizationId',
  },
}))

describe('OrganizationService', () => {
  let orgService: OrganizationService
  let mockContext: ServiceContext

  beforeEach(() => {
    vi.clearAllMocks()
    orgService = new OrganizationService()

    mockContext = {
      organizationId: 'org-123',
      userId: 'user-123',
      memberId: 'member-123',
      memberRole: 'admin',
      userName: 'Test User',
      userEmail: 'test@example.com',
    }
  })

  describe('getAuthConfig', () => {
    it('should return auth config when organization exists', async () => {
      const authConfig = {
        oauth: { google: true, github: false, microsoft: false },
        ssoRequired: false,
        openSignup: false,
      }

      const mockOrg = {
        id: 'org-123',
        authConfig: JSON.stringify(authConfig),
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getAuthConfig('org-123')

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getAuthConfig('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(DEFAULT_AUTH_CONFIG)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getAuthConfig('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })

    it('should handle database errors', async () => {
      mockDb.query.organization.findFirst.mockRejectedValue(new Error('Database error'))

      const result = await orgService.getAuthConfig('org-123')

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
        ssoRequired: false,
        openSignup: false,
      }

      const mockOrg = {
        id: 'org-123',
        authConfig: JSON.stringify(existingConfig),
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

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

      const result = await orgService.updateAuthConfig(input, mockContext)

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

      const result = await orgService.updateAuthConfig(input, memberContext)

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

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

      const result = await orgService.updateAuthConfig(input, ownerContext)

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getPortalConfig('org-123')

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getPortalConfig('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(DEFAULT_PORTAL_CONFIG)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getPortalConfig('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

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

      const result = await orgService.updatePortalConfig(input, mockContext)

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

      const result = await orgService.updatePortalConfig(input, memberContext)

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getBrandingConfig('org-123')

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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getBrandingConfig('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getBrandingConfig('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })

    it('should handle invalid JSON gracefully', async () => {
      const mockOrg = {
        id: 'org-123',
        brandingConfig: 'invalid json{',
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getBrandingConfig('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })
  })

  describe('updateBrandingConfig', () => {
    it('should update branding config successfully', async () => {
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

      const result = await orgService.updateBrandingConfig(brandingConfig, mockContext)

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

      const result = await orgService.updateBrandingConfig(brandingConfig, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('listSsoProviders', () => {
    it('should return list of SSO providers', async () => {
      const mockProviders = [
        {
          id: 'provider-1',
          organizationId: 'org-123',
          providerId: 'sso_1234567890',
          issuer: 'Okta',
          domain: 'example.com',
          oidcConfig: JSON.stringify({
            clientId: 'client-123',
            clientSecret: 'secret-123',
            discoveryUrl: 'https://example.com/.well-known/openid-configuration',
          } as OidcConfig),
          samlConfig: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      mockDb.query.ssoProvider.findMany.mockResolvedValue(mockProviders)

      const result = await orgService.listSsoProviders(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].issuer).toBe('Okta')
        expect(result.value[0].oidcConfig?.clientSecret).toBe('••••••••')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const result = await orgService.listSsoProviders(memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return empty array when no providers exist', async () => {
      mockDb.query.ssoProvider.findMany.mockResolvedValue([])

      const result = await orgService.listSsoProviders(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should mask client secrets in responses', async () => {
      const mockProviders = [
        {
          id: 'provider-1',
          organizationId: 'org-123',
          providerId: 'sso_1234567890',
          issuer: 'Okta',
          domain: 'example.com',
          oidcConfig: JSON.stringify({
            clientId: 'client-123',
            clientSecret: 'super-secret-value',
            discoveryUrl: 'https://example.com/.well-known/openid-configuration',
          } as OidcConfig),
          samlConfig: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      mockDb.query.ssoProvider.findMany.mockResolvedValue(mockProviders)

      const result = await orgService.listSsoProviders(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value[0].oidcConfig?.clientSecret).toBe('••••••••')
        expect(result.value[0].oidcConfig?.clientSecret).not.toBe('super-secret-value')
      }
    })
  })

  describe('getSsoProvider', () => {
    it('should return SSO provider when found', async () => {
      const mockProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: JSON.stringify({
          clientId: 'client-123',
          clientSecret: 'secret-123',
        } as OidcConfig),
        samlConfig: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(mockProvider)

      const result = await orgService.getSsoProvider('provider-1', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('provider-1')
        expect(result.value.oidcConfig?.clientSecret).toBe('••••••••')
      }
    })

    it('should return error when provider not found', async () => {
      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const result = await orgService.getSsoProvider('provider-nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SSO_PROVIDER_NOT_FOUND')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const result = await orgService.getSsoProvider('provider-1', memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('createSsoProvider', () => {
    it('should create SSO provider successfully', async () => {
      const input: CreateSsoProviderInput = {
        type: 'oidc',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: {
          clientId: 'client-123',
          clientSecret: 'secret-123',
          discoveryUrl: 'https://example.com/.well-known/openid-configuration',
        },
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const mockCreated = {
        id: 'provider-new',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: JSON.stringify(input.oidcConfig),
        samlConfig: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockInsertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockCreated]),
      }

      mockDb.insert.mockReturnValue(mockInsertChain)

      const result = await orgService.createSsoProvider(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.issuer).toBe('Okta')
        expect(result.value.domain).toBe('example.com')
      }
    })

    it('should return error when domain format is invalid', async () => {
      const input: CreateSsoProviderInput = {
        type: 'oidc',
        issuer: 'Okta',
        domain: 'invalid domain!',
        oidcConfig: {
          clientId: 'client-123',
          clientSecret: 'secret-123',
        },
      }

      const result = await orgService.createSsoProvider(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBe('Invalid domain format')
      }
    })

    it('should return error when duplicate domain exists', async () => {
      const input: CreateSsoProviderInput = {
        type: 'oidc',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: {
          clientId: 'client-123',
          clientSecret: 'secret-123',
        },
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue({
        id: 'existing-provider',
        domain: 'example.com',
      })

      const result = await orgService.createSsoProvider(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_DOMAIN')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: CreateSsoProviderInput = {
        type: 'oidc',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: {
          clientId: 'client-123',
          clientSecret: 'secret-123',
        },
      }

      const result = await orgService.createSsoProvider(input, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should normalize domain to lowercase', async () => {
      const input: CreateSsoProviderInput = {
        type: 'oidc',
        issuer: 'Okta',
        domain: 'Example.COM',
        oidcConfig: {
          clientId: 'client-123',
          clientSecret: 'secret-123',
        },
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const mockCreated = {
        id: 'provider-new',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: JSON.stringify(input.oidcConfig),
        samlConfig: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockInsertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockCreated]),
      }

      mockDb.insert.mockReturnValue(mockInsertChain)

      const result = await orgService.createSsoProvider(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.domain).toBe('example.com')
      }
    })
  })

  describe('updateSsoProvider', () => {
    it('should update SSO provider successfully', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: JSON.stringify({
          clientId: 'old-client-id',
          clientSecret: 'old-secret',
        } as OidcConfig),
        samlConfig: null,
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(existingProvider)

      const input: UpdateSsoProviderInput = {
        issuer: 'Okta Updated',
        oidcConfig: {
          clientId: 'new-client-id',
        },
      }

      const mockUpdated = {
        ...existingProvider,
        issuer: 'Okta Updated',
        oidcConfig: JSON.stringify({
          clientId: 'new-client-id',
          clientSecret: 'old-secret',
        } as OidcConfig),
        updatedAt: new Date(),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateSsoProvider('provider-1', input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.issuer).toBe('Okta Updated')
      }
    })

    it('should return error when provider not found', async () => {
      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const input: UpdateSsoProviderInput = {
        issuer: 'Updated',
      }

      const result = await orgService.updateSsoProvider('provider-nonexistent', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SSO_PROVIDER_NOT_FOUND')
      }
    })

    it('should return error when domain format is invalid', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: null,
        samlConfig: null,
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(existingProvider)

      const input: UpdateSsoProviderInput = {
        domain: 'invalid domain!',
      }

      const result = await orgService.updateSsoProvider('provider-1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBe('Invalid domain format')
      }
    })

    it('should return error when duplicate domain exists', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: null,
        samlConfig: null,
      }

      mockDb.query.ssoProvider.findFirst
        .mockResolvedValueOnce(existingProvider)
        .mockResolvedValueOnce({
          id: 'provider-2',
          domain: 'another-example.com',
        })

      const input: UpdateSsoProviderInput = {
        domain: 'another-example.com',
      }

      const result = await orgService.updateSsoProvider('provider-1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_DOMAIN')
      }
    })

    it('should return error when no fields provided', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: null,
        samlConfig: null,
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(existingProvider)

      const input: UpdateSsoProviderInput = {}

      const result = await orgService.updateSsoProvider('provider-1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBe('No fields provided to update')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: UpdateSsoProviderInput = {
        issuer: 'Updated',
      }

      const result = await orgService.updateSsoProvider('provider-1', input, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('deleteSsoProvider', () => {
    it('should delete SSO provider successfully', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(existingProvider)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }

      mockDb.delete.mockReturnValue(mockDeleteChain)

      const result = await orgService.deleteSsoProvider('provider-1', mockContext)

      expect(result.success).toBe(true)
    })

    it('should return error when provider not found', async () => {
      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const result = await orgService.deleteSsoProvider('provider-nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('SSO_PROVIDER_NOT_FOUND')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const result = await orgService.deleteSsoProvider('provider-1', memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('getPublicAuthConfig', () => {
    it('should return public auth config without secrets', async () => {
      const authConfig = {
        oauth: { google: true, github: false, microsoft: false },
        ssoRequired: false,
        openSignup: true,
      }

      const mockOrg = {
        id: 'org-123',
        slug: 'acme',
        authConfig: JSON.stringify(authConfig),
      }

      const mockProviders = [
        {
          providerId: 'sso_123',
          issuer: 'Okta',
          domain: 'example.com',
        },
      ]

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)
      mockDb.query.ssoProvider.findMany.mockResolvedValue(mockProviders)

      const result = await orgService.getPublicAuthConfig('acme')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(true)
        expect(result.value.openSignup).toBe(true)
        expect(result.value.ssoProviders).toHaveLength(1)
        expect(result.value.ssoProviders[0].issuer).toBe('Okta')
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getPublicAuthConfig('nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
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

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getPublicPortalConfig('acme')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.oauth.google).toBe(false)
        expect(result.value.oauth.github).toBe(true)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getPublicPortalConfig('nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })
  })

  describe('checkSsoByDomain', () => {
    it('should return SSO info when domain has SSO configured', async () => {
      const mockProvider = {
        providerId: 'sso_123',
        issuer: 'Okta',
        domain: 'example.com',
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(mockProvider)

      const result = await orgService.checkSsoByDomain('user@example.com')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).not.toBeNull()
        expect(result.value?.hasSso).toBe(true)
        expect(result.value?.domain).toBe('example.com')
      }
    })

    it('should return null when no SSO configured for domain', async () => {
      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      const result = await orgService.checkSsoByDomain('user@example.com')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })

    it('should return error when email format is invalid', async () => {
      const result = await orgService.checkSsoByDomain('invalid-email')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBe('Invalid email address')
      }
    })

    it('should extract domain correctly from email', async () => {
      mockDb.query.ssoProvider.findFirst.mockResolvedValue(null)

      await orgService.checkSsoByDomain('user@subdomain.example.com')

      expect(mockDb.query.ssoProvider.findFirst).toHaveBeenCalled()
    })
  })

  describe('domain validation regex', () => {
    it('should accept valid domain formats', () => {
      const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
      const validDomains = [
        'example.com',
        'subdomain.example.com',
        'my-domain.co.uk',
        'test123.org',
        'a.b.c.d.example.io',
      ]

      for (const domain of validDomains) {
        expect(domainRegex.test(domain)).toBe(true)
      }
    })

    it('should reject invalid domain formats', () => {
      const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
      const invalidDomains = [
        'invalid domain',
        'example',
        'example.',
        '.example.com',
        'example..com',
        'UPPERCASE.COM',
        'example.com/path',
        'http://example.com',
      ]

      for (const domain of invalidDomains) {
        expect(domainRegex.test(domain)).toBe(false)
      }
    })
  })
})
