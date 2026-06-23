/**
 * Shared test factories for the auth hook suite.
 *
 * The Better-Auth hooks consume a fully-typed `TenantSettings` returned
 * by `getTenantSettings()`. Only a handful of fields are load-bearing
 * (`authConfig` + `verifiedDomains`); everything else is required by
 * the type signature but ignored at runtime. These factories give us a
 * single place to hold the inert defaults so individual tests only
 * declare the knobs they actually care about — and they return
 * fully-typed objects so we never need `as unknown as` at the call
 * sites.
 */
import type {
  AuthConfig,
  TenantSettings,
  VerifiedDomain,
} from '@/lib/server/domains/settings/settings.types'

type SsoOidc = NonNullable<AuthConfig['ssoOidc']>

export function makeVerifiedDomain(
  name: string,
  enforced: boolean,
  overrides: Partial<Omit<VerifiedDomain, 'name' | 'enforced'>> = {}
): VerifiedDomain {
  return {
    id: `domain_${name.replace(/\W/g, '_')}` as `domain_${string}`,
    name,
    verificationToken: 'tok',
    verifiedAt: '2026-05-01T00:00:00.000Z',
    enforced,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeSsoOidc(overrides: Partial<SsoOidc> = {}): SsoOidc {
  return {
    enabled: true,
    discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    clientId: 'cid',
    autoCreateUsers: false,
    ...overrides,
  }
}

export function makeAuthConfig(
  overrides: Omit<Partial<AuthConfig>, 'ssoOidc'> & {
    ssoOidc?: Partial<SsoOidc> | null
  } = {}
): AuthConfig {
  const { ssoOidc, ...rest } = overrides
  return {
    oauth: {},
    openSignup: false,
    ssoOidc: ssoOidc === null ? undefined : makeSsoOidc(ssoOidc ?? {}),
    ...rest,
  }
}

const PORTAL_FEATURES_DEFAULTS = {
  allowEditAfterEngagement: false,
  allowDeleteAfterEngagement: false,
  showPublicEditHistory: false,
  allowAnonymous: true,
}

export function makeTenant(overrides: Partial<TenantSettings> = {}): TenantSettings {
  return {
    settings: {},
    name: 'test',
    slug: 'test',
    authConfig: makeAuthConfig(),
    portalConfig: {
      oauth: {},
      features: PORTAL_FEATURES_DEFAULTS,
      moderationDefault: { requireApproval: 'none' },
    },
    brandingConfig: {} as TenantSettings['brandingConfig'],
    developerConfig: {} as TenantSettings['developerConfig'],
    helpCenterConfig: {} as TenantSettings['helpCenterConfig'],
    customCss: '',
    publicAuthConfig: { oauth: {}, openSignup: false },
    publicPortalConfig: { features: PORTAL_FEATURES_DEFAULTS },
    publicWidgetConfig: {} as TenantSettings['publicWidgetConfig'],
    featureFlags: {} as TenantSettings['featureFlags'],
    brandingData: {} as TenantSettings['brandingData'],
    faviconData: null,
    managedFieldPaths: [],
    verifiedDomains: [],
    state: 'active',
    ...overrides,
  }
}
