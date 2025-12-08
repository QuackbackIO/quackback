import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrganizationService } from '../organization.service'
import type {
  UpdateSecurityInput,
  UpdatePortalAuthInput,
  ThemeConfig,
  CreateSsoProviderInput,
  UpdateSsoProviderInput,
  OidcConfig,
} from '../organization.types'
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

  describe('getSecuritySettings', () => {
    it('should return security settings when organization exists', async () => {
      const mockOrg = {
        id: 'org-123',
        strictSsoMode: false,
        passwordAuthEnabled: true,
        googleOAuthEnabled: true,
        githubOAuthEnabled: false,
        microsoftOAuthEnabled: false,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getSecuritySettings('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({
          strictSsoMode: false,
          passwordAuthEnabled: true,
          googleOAuthEnabled: true,
          githubOAuthEnabled: false,
          microsoftOAuthEnabled: false,
        })
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getSecuritySettings('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })

    it('should handle database errors', async () => {
      mockDb.query.organization.findFirst.mockRejectedValue(new Error('Database error'))

      const result = await orgService.getSecuritySettings('org-123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Failed to fetch security settings')
      }
    })
  })

  describe('updateSecuritySettings', () => {
    it('should update security settings successfully', async () => {
      const input: UpdateSecurityInput = {
        strictSsoMode: true,
        passwordAuthEnabled: false,
      }

      const mockUpdated = {
        id: 'org-123',
        strictSsoMode: true,
        passwordAuthEnabled: false,
        googleOAuthEnabled: true,
        githubOAuthEnabled: false,
        microsoftOAuthEnabled: false,
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateSecuritySettings(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.strictSsoMode).toBe(true)
        expect(result.value.passwordAuthEnabled).toBe(false)
      }
    })

    it('should return error when user is not owner or admin', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: UpdateSecurityInput = {
        strictSsoMode: true,
      }

      const result = await orgService.updateSecuritySettings(input, memberContext)

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

      const input: UpdateSecurityInput = {
        strictSsoMode: true,
      }

      const mockUpdated = {
        id: 'org-123',
        strictSsoMode: true,
        passwordAuthEnabled: true,
        googleOAuthEnabled: true,
        githubOAuthEnabled: false,
        microsoftOAuthEnabled: false,
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateSecuritySettings(input, ownerContext)

      expect(result.success).toBe(true)
    })

    it('should return error when no fields provided', async () => {
      const input: UpdateSecurityInput = {}

      const result = await orgService.updateSecuritySettings(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBe('No fields provided to update')
      }
    })

    it('should update multiple OAuth settings', async () => {
      const input: UpdateSecurityInput = {
        googleOAuthEnabled: true,
        githubOAuthEnabled: true,
        microsoftOAuthEnabled: true,
      }

      const mockUpdated = {
        id: 'org-123',
        strictSsoMode: false,
        passwordAuthEnabled: true,
        googleOAuthEnabled: true,
        githubOAuthEnabled: true,
        microsoftOAuthEnabled: true,
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateSecuritySettings(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.googleOAuthEnabled).toBe(true)
        expect(result.value.githubOAuthEnabled).toBe(true)
        expect(result.value.microsoftOAuthEnabled).toBe(true)
      }
    })
  })

  describe('getPortalAuthSettings', () => {
    it('should return portal auth settings when organization exists', async () => {
      const mockOrg = {
        id: 'org-123',
        portalAuthEnabled: true,
        portalPasswordEnabled: true,
        portalGoogleEnabled: false,
        portalGithubEnabled: false,
        portalRequireAuth: false,
        portalPublicVoting: true,
        portalPublicCommenting: true,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getPortalAuthSettings('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.portalAuthEnabled).toBe(true)
        expect(result.value.portalPublicVoting).toBe(true)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getPortalAuthSettings('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })
  })

  describe('updatePortalAuthSettings', () => {
    it('should update portal auth settings successfully', async () => {
      const input: UpdatePortalAuthInput = {
        portalAuthEnabled: true,
        portalPublicVoting: false,
      }

      const mockUpdated = {
        id: 'org-123',
        portalAuthEnabled: true,
        portalPasswordEnabled: true,
        portalGoogleEnabled: false,
        portalGithubEnabled: false,
        portalRequireAuth: false,
        portalPublicVoting: false,
        portalPublicCommenting: true,
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updatePortalAuthSettings(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.portalAuthEnabled).toBe(true)
        expect(result.value.portalPublicVoting).toBe(false)
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const input: UpdatePortalAuthInput = {
        portalAuthEnabled: true,
      }

      const result = await orgService.updatePortalAuthSettings(input, memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return error when no fields provided', async () => {
      const input: UpdatePortalAuthInput = {}

      const result = await orgService.updatePortalAuthSettings(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })
  })

  describe('getTheme', () => {
    it('should return theme config when organization exists', async () => {
      const themeConfig: ThemeConfig = {
        preset: 'default',
        light: {
          background: '#ffffff',
          foreground: '#000000',
        },
      }

      const mockOrg = {
        id: 'org-123',
        themeConfig: JSON.stringify(themeConfig),
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getTheme('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.preset).toBe('default')
        expect(result.value.light?.background).toBe('#ffffff')
      }
    })

    it('should return empty config when theme is null', async () => {
      const mockOrg = {
        id: 'org-123',
        themeConfig: null,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getTheme('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getTheme('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })

    it('should handle invalid JSON gracefully', async () => {
      const mockOrg = {
        id: 'org-123',
        themeConfig: 'invalid json{',
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getTheme('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual({})
      }
    })
  })

  describe('updateTheme', () => {
    it('should update theme successfully', async () => {
      const themeConfig: ThemeConfig = {
        preset: 'ocean',
        light: {
          primary: '#0066cc',
        },
      }

      const mockUpdated = {
        id: 'org-123',
        themeConfig: JSON.stringify(themeConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateTheme(themeConfig, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(themeConfig)
      }
    })

    it('should return error when user is unauthorized', async () => {
      const memberContext: ServiceContext = {
        ...mockContext,
        memberRole: 'member',
      }

      const themeConfig: ThemeConfig = {
        preset: 'ocean',
      }

      const result = await orgService.updateTheme(themeConfig, memberContext)

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

    it('should accept valid domain formats', async () => {
      const validDomains = [
        'example.com',
        'subdomain.example.com',
        'test-domain.co.uk',
        'my.long.domain.example.org',
      ]

      for (const domain of validDomains) {
        const input: CreateSsoProviderInput = {
          type: 'oidc',
          issuer: 'Provider',
          domain,
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
          issuer: 'Provider',
          domain: domain.toLowerCase(),
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

    it('should merge OIDC config correctly', async () => {
      const existingProvider = {
        id: 'provider-1',
        organizationId: 'org-123',
        providerId: 'sso_1234567890',
        issuer: 'Okta',
        domain: 'example.com',
        oidcConfig: JSON.stringify({
          clientId: 'old-client-id',
          clientSecret: 'old-secret',
          discoveryUrl: 'https://old.example.com',
        } as OidcConfig),
        samlConfig: null,
      }

      mockDb.query.ssoProvider.findFirst.mockResolvedValue(existingProvider)

      const input: UpdateSsoProviderInput = {
        oidcConfig: {
          clientId: 'new-client-id',
        },
      }

      const mockUpdated = {
        ...existingProvider,
        oidcConfig: JSON.stringify({
          clientId: 'new-client-id',
          clientSecret: 'old-secret',
          discoveryUrl: 'https://old.example.com',
        } as OidcConfig),
      }

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockUpdated]),
      }

      mockDb.update.mockReturnValue(mockUpdateChain)

      const result = await orgService.updateSsoProvider('provider-1', input, mockContext)

      expect(result.success).toBe(true)
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
      const mockOrg = {
        id: 'org-123',
        slug: 'acme',
        passwordAuthEnabled: true,
        googleOAuthEnabled: true,
        githubOAuthEnabled: false,
        microsoftOAuthEnabled: false,
        openSignupEnabled: true,
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
        expect(result.value.passwordEnabled).toBe(true)
        expect(result.value.googleEnabled).toBe(true)
        expect(result.value.openSignupEnabled).toBe(true)
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

  describe('getPortalPublicAuthConfig', () => {
    it('should return portal public auth config', async () => {
      const mockOrg = {
        id: 'org-123',
        slug: 'acme',
        portalAuthEnabled: true,
        portalPasswordEnabled: true,
        portalGoogleEnabled: false,
        portalGithubEnabled: true,
        portalRequireAuth: false,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.getPortalPublicAuthConfig('acme')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.portalAuthEnabled).toBe(true)
        expect(result.value.passwordEnabled).toBe(true)
        expect(result.value.githubEnabled).toBe(true)
        expect(result.value.requireAuth).toBe(false)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.getPortalPublicAuthConfig('nonexistent')

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

  describe('checkPublicVotingPermission', () => {
    it('should allow voting when portalPublicVoting is enabled', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicVoting: true,
        portalRequireAuth: false,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.checkPublicVotingPermission('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowVoting).toBe(true)
        expect(result.value.isMember).toBe(false)
      }
    })

    it('should allow voting when user is member', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicVoting: false,
        portalRequireAuth: false,
      }

      const mockMember = {
        id: 'member-123',
        role: 'admin',
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)
      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await orgService.checkPublicVotingPermission('org-123', 'user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowVoting).toBe(true)
        expect(result.value.isMember).toBe(true)
        expect(result.value.member?.role).toBe('admin')
      }
    })

    it('should deny voting when neither public voting nor membership', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicVoting: false,
        portalRequireAuth: true,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)
      mockDb.query.member.findFirst.mockResolvedValue(undefined)

      const result = await orgService.checkPublicVotingPermission('org-123', 'user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowVoting).toBe(false)
        expect(result.value.isMember).toBe(false)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.checkPublicVotingPermission('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
    })
  })

  describe('checkPublicCommentingPermission', () => {
    it('should allow commenting when portalPublicCommenting is enabled', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicCommenting: true,
        portalRequireAuth: false,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)

      const result = await orgService.checkPublicCommentingPermission('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowCommenting).toBe(true)
        expect(result.value.isMember).toBe(false)
      }
    })

    it('should allow commenting when user is member', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicCommenting: false,
        portalRequireAuth: false,
      }

      const mockMember = {
        id: 'member-123',
        role: 'member',
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)
      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await orgService.checkPublicCommentingPermission('org-123', 'user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowCommenting).toBe(true)
        expect(result.value.isMember).toBe(true)
        expect(result.value.member?.role).toBe('member')
      }
    })

    it('should deny commenting when neither public commenting nor membership', async () => {
      const mockOrg = {
        id: 'org-123',
        portalPublicCommenting: false,
        portalRequireAuth: true,
      }

      mockDb.query.organization.findFirst.mockResolvedValue(mockOrg)
      mockDb.query.member.findFirst.mockResolvedValue(undefined)

      const result = await orgService.checkPublicCommentingPermission('org-123', 'user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowCommenting).toBe(false)
        expect(result.value.isMember).toBe(false)
      }
    })

    it('should return error when organization not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null)

      const result = await orgService.checkPublicCommentingPermission('org-nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ORGANIZATION_NOT_FOUND')
      }
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
