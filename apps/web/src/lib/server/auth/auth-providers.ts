/**
 * Auth Provider Registry
 *
 * Defines all 33 Better Auth social providers with their credential fields.
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
    id: 'atlassian',
    name: 'Atlassian',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}atlassian`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials(
      'Atlassian',
      'https://developer.atlassian.com/console/myapps/'
    ),
  },
  {
    id: 'cognito',
    name: 'Cognito',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}cognito`,
    iconBg: 'bg-orange-600',
    platformCredentials: baseCredentials('Cognito', 'https://console.aws.amazon.com/cognito/'),
  },
  {
    id: 'discord',
    name: 'Discord',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}discord`,
    iconBg: 'bg-indigo-600',
    platformCredentials: baseCredentials('Discord', 'https://discord.com/developers/applications'),
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}dropbox`,
    iconBg: 'bg-blue-700',
    platformCredentials: baseCredentials('Dropbox', 'https://www.dropbox.com/developers/apps'),
  },
  {
    id: 'facebook',
    name: 'Facebook',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}facebook`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials('Facebook', 'https://developers.facebook.com/apps/'),
  },
  {
    id: 'figma',
    name: 'Figma',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}figma`,
    iconBg: 'bg-purple-500',
    platformCredentials: baseCredentials('Figma', 'https://www.figma.com/developers/apps'),
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
    id: 'huggingface',
    name: 'Hugging Face',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}huggingface`,
    iconBg: 'bg-yellow-500',
    platformCredentials: baseCredentials(
      'Hugging Face',
      'https://huggingface.co/settings/connected-applications'
    ),
  },
  {
    id: 'kakao',
    name: 'Kakao',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}kakao`,
    iconBg: 'bg-yellow-400',
    platformCredentials: baseCredentials('Kakao', 'https://developers.kakao.com/console/app'),
  },
  {
    id: 'kick',
    name: 'Kick',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}kick`,
    iconBg: 'bg-green-500',
    platformCredentials: baseCredentials('Kick'),
  },
  {
    id: 'line',
    name: 'LINE',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}line`,
    iconBg: 'bg-green-500',
    platformCredentials: baseCredentials('LINE', 'https://developers.line.biz/console/'),
  },
  {
    id: 'linear',
    name: 'Linear',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}linear`,
    iconBg: 'bg-indigo-500',
    platformCredentials: baseCredentials('Linear', 'https://linear.app/settings/api'),
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
    id: 'naver',
    name: 'Naver',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}naver`,
    iconBg: 'bg-green-600',
    platformCredentials: baseCredentials('Naver', 'https://developers.naver.com/apps/'),
  },
  {
    id: 'notion',
    name: 'Notion',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}notion`,
    iconBg: 'bg-gray-900',
    platformCredentials: baseCredentials('Notion', 'https://www.notion.so/my-integrations'),
  },
  {
    id: 'paybin',
    name: 'Paybin',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}paybin`,
    iconBg: 'bg-emerald-600',
    platformCredentials: baseCredentials('Paybin'),
  },
  {
    id: 'paypal',
    name: 'PayPal',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}paypal`,
    iconBg: 'bg-blue-800',
    platformCredentials: baseCredentials(
      'PayPal',
      'https://developer.paypal.com/dashboard/applications'
    ),
  },
  {
    id: 'polar',
    name: 'Polar',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}polar`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials('Polar'),
  },
  {
    id: 'reddit',
    name: 'Reddit',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}reddit`,
    iconBg: 'bg-orange-600',
    platformCredentials: baseCredentials('Reddit', 'https://www.reddit.com/prefs/apps'),
  },
  {
    id: 'roblox',
    name: 'Roblox',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}roblox`,
    iconBg: 'bg-red-600',
    platformCredentials: baseCredentials('Roblox', 'https://create.roblox.com/credentials'),
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}salesforce`,
    iconBg: 'bg-sky-600',
    platformCredentials: baseCredentials('Salesforce'),
  },
  {
    id: 'slack',
    name: 'Slack',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}slack`,
    iconBg: 'bg-purple-600',
    platformCredentials: baseCredentials('Slack', 'https://api.slack.com/apps'),
  },
  {
    id: 'spotify',
    name: 'Spotify',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}spotify`,
    iconBg: 'bg-green-600',
    platformCredentials: baseCredentials('Spotify', 'https://developer.spotify.com/dashboard'),
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}tiktok`,
    iconBg: 'bg-black',
    platformCredentials: baseCredentials('TikTok', 'https://developers.tiktok.com/'),
  },
  {
    id: 'twitch',
    name: 'Twitch',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}twitch`,
    iconBg: 'bg-purple-600',
    platformCredentials: baseCredentials('Twitch', 'https://dev.twitch.tv/console/apps'),
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
    id: 'vercel',
    name: 'Vercel',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}vercel`,
    iconBg: 'bg-black',
    platformCredentials: baseCredentials('Vercel', 'https://vercel.com/account/tokens'),
  },
  {
    id: 'vk',
    name: 'VK',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}vk`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials('VK', 'https://dev.vk.com/ru/admin/apps-list'),
  },
  {
    id: 'zoom',
    name: 'Zoom',
    credentialType: `${AUTH_CREDENTIAL_PREFIX}zoom`,
    iconBg: 'bg-blue-600',
    platformCredentials: baseCredentials('Zoom', 'https://marketplace.zoom.us/develop/create'),
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
