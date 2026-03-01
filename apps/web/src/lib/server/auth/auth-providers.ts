/**
 * Auth Provider Registry
 *
 * Defines the top 10 Better Auth social providers with their credential fields.
 * Credentials are stored encrypted in the integrationPlatformCredentials table
 * with an 'auth_' prefix (e.g. 'auth_github', 'auth_google').
 */

import type { PlatformCredentialField } from '@/lib/server/integrations/types'

export interface AuthProviderDefinition {
  /** Better Auth provider ID: 'github', 'google', etc. */
  id: string
  /** Display name: 'GitHub', 'Google', etc. */
  name: string
  /** DB storage key: 'auth_github', 'auth_google', etc. */
  credentialType: string
  /** Tailwind bg class for icon container: 'bg-gray-900', 'bg-blue-600', etc. */
  iconBg: string
  /** Provider type: 'social' (default, built-in Better Auth) or 'generic-oauth' (genericOAuth plugin) */
  type?: 'generic-oauth'
  /** Credential fields required for this provider */
  platformCredentials: PlatformCredentialField[]
}

const AUTH_CREDENTIAL_PREFIX = 'auth_'

function baseCredentials(providerName: string, helpUrl?: string): PlatformCredentialField[] {
  return [
    {
      key: 'clientId',
      label: 'Client ID',
      placeholder: 'Enter your Client ID',
      sensitive: false,
      helpUrl,
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      placeholder: 'Enter your Client Secret',
      sensitive: true,
    },
  ]
}

export const AUTH_PROVIDERS: AuthProviderDefinition[] = [
  {
    id: 'apple',
    name: 'Apple',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}apple`,
    iconBg: 'bg-black',
    platformCredentials: [
      ...baseCredentials('Apple', 'https://developer.apple.com/account/resources/identifiers/list'),
      {
        key: 'appBundleIdentifier',
        label: 'App Bundle Identifier',
        placeholder: 'com.example.app (optional)',
        sensitive: false,
        helpText: 'Required only for native app sign-in',
      },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}discord`,
    iconBg: 'bg-indigo-600',
    platformCredentials: baseCredentials('Discord', 'https://discord.com/developers/applications'),
  },
  {
    id: 'facebook',
    name: 'Facebook',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}facebook`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials('Facebook', 'https://developers.facebook.com/apps/'),
  },
  {
    id: 'github',
    name: 'GitHub',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}github`,
    iconBg: 'bg-gray-900',
    platformCredentials: baseCredentials('GitHub', 'https://github.com/settings/developers'),
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}gitlab`,
    iconBg: 'bg-orange-600',
    platformCredentials: [
      ...baseCredentials('GitLab', 'https://gitlab.com/-/user_settings/applications'),
      {
        key: 'issuer',
        label: 'Issuer URL',
        placeholder: 'https://gitlab.example.com (optional)',
        sensitive: false,
        helpText: 'For self-hosted GitLab instances',
      },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}google`,
    iconBg: 'bg-red-500',
    platformCredentials: baseCredentials(
      'Google',
      'https://console.cloud.google.com/apis/credentials'
    ),
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}linkedin`,
    iconBg: 'bg-blue-700',
    platformCredentials: baseCredentials('LinkedIn', 'https://www.linkedin.com/developers/apps'),
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}microsoft`,
    iconBg: 'bg-sky-500',
    platformCredentials: [
      ...baseCredentials(
        'Microsoft',
        'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
      ),
      {
        key: 'tenantId',
        label: 'Tenant ID',
        placeholder: 'common (optional)',
        sensitive: false,
        helpText: 'Defaults to "common" for multi-tenant apps',
      },
    ],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}reddit`,
    iconBg: 'bg-orange-600',
    platformCredentials: baseCredentials('Reddit', 'https://www.reddit.com/prefs/apps'),
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}twitter`,
    iconBg: 'bg-black',
    platformCredentials: baseCredentials(
      'Twitter',
      'https://developer.x.com/en/portal/projects-and-apps'
    ),
  },
  {
    id: 'custom-oidc',
    name: 'Custom OIDC',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}custom-oidc`,
    iconBg: 'bg-violet-600',
    type: 'generic-oauth',
    platformCredentials: [
      {
        key: 'displayName',
        label: 'Display Name',
        placeholder: 'e.g. Okta, Auth0, Keycloak',
        sensitive: false,
        helpText: 'Name shown on the sign-in button',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        placeholder: 'Enter your Client ID',
        sensitive: false,
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        placeholder: 'Enter your Client Secret',
        sensitive: true,
      },
      {
        key: 'discoveryUrl',
        label: 'Discovery URL',
        placeholder: 'https://example.com/.well-known/openid-configuration',
        sensitive: false,
        helpText: 'If provided, authorization and token URLs are auto-discovered',
      },
      {
        key: 'authorizationUrl',
        label: 'Authorization URL',
        placeholder: 'https://example.com/oauth/authorize',
        sensitive: false,
        helpText: 'Required if Discovery URL is not provided',
      },
      {
        key: 'tokenUrl',
        label: 'Token URL',
        placeholder: 'https://example.com/oauth/token',
        sensitive: false,
        helpText: 'Required if Discovery URL is not provided',
      },
      {
        key: 'scopes',
        label: 'Scopes',
        placeholder: 'openid email profile',
        sensitive: false,
        helpText: 'Space-separated list of scopes (defaults to "openid email profile")',
      },
    ],
  },
]

// Lookup maps for fast access
const byCredentialType = new Map(AUTH_PROVIDERS.map((p) => [p.credentialType, p]))
const byProviderId = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]))

export function getAuthProvider(credentialType: string): AuthProviderDefinition | undefined {
  return byCredentialType.get(credentialType)
}

export function getAuthProviderByProviderId(id: string): AuthProviderDefinition | undefined {
  return byProviderId.get(id)
}

export function getAllAuthProviders(): AuthProviderDefinition[] {
  return AUTH_PROVIDERS
}

export function isAuthProviderCredentialType(type: string): boolean {
  return byCredentialType.has(type)
}

export function credentialTypeForProvider(providerId: string): string {
  return `${AUTH_CREDENTIAL_PREFIX}${providerId}`
}
