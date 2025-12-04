/**
 * SSO Provider Templates
 *
 * Pre-configured templates for popular OIDC and SAML identity providers.
 * Used by the SSO provider creation dialog to auto-fill configuration.
 */

export interface SsoProviderTemplateField {
  name: string
  label: string
  placeholder: string
  description?: string
}

export interface SsoProviderTemplate {
  id: string
  name: string
  type: 'oidc' | 'saml'
  description: string
  // Static values (no placeholders)
  discoveryUrl?: string
  issuer?: string
  // Dynamic templates with {placeholder} values
  discoveryUrlTemplate?: string
  issuerTemplate?: string
  // Fields to collect from user (for dynamic templates)
  fields: SsoProviderTemplateField[]
  // Setup documentation URL
  docsUrl?: string
}

export const SSO_PROVIDER_TEMPLATES: Record<string, SsoProviderTemplate> = {
  // Enterprise Identity Providers
  okta: {
    id: 'okta',
    name: 'Okta',
    type: 'oidc',
    description: 'Enterprise identity management',
    discoveryUrlTemplate: 'https://{domain}.okta.com/.well-known/openid-configuration',
    issuerTemplate: 'https://{domain}.okta.com',
    fields: [
      {
        name: 'domain',
        label: 'Okta Domain',
        placeholder: 'your-company',
        description: 'Your Okta subdomain (e.g., "your-company" from your-company.okta.com)',
      },
    ],
    docsUrl: 'https://developer.okta.com/docs/guides/implement-oauth-for-okta/main/',
  },

  azure: {
    id: 'azure',
    name: 'Microsoft Entra ID',
    type: 'oidc',
    description: 'Azure Active Directory (Microsoft 365)',
    discoveryUrlTemplate:
      'https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration',
    issuerTemplate: 'https://login.microsoftonline.com/{tenantId}/v2.0',
    fields: [
      {
        name: 'tenantId',
        label: 'Directory (Tenant) ID',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        description: 'Found in Azure Portal > Microsoft Entra ID > Overview',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app',
  },

  google_workspace: {
    id: 'google_workspace',
    name: 'Google Workspace',
    type: 'oidc',
    description: 'Google Workspace (G Suite) SSO',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    issuer: 'https://accounts.google.com',
    fields: [],
    docsUrl: 'https://developers.google.com/identity/openid-connect/openid-connect',
  },

  onelogin: {
    id: 'onelogin',
    name: 'OneLogin',
    type: 'oidc',
    description: 'OneLogin identity management',
    discoveryUrlTemplate: 'https://{domain}.onelogin.com/oidc/2/.well-known/openid-configuration',
    issuerTemplate: 'https://{domain}.onelogin.com/oidc/2',
    fields: [
      {
        name: 'domain',
        label: 'OneLogin Subdomain',
        placeholder: 'your-company',
        description:
          'Your OneLogin subdomain (e.g., "your-company" from your-company.onelogin.com)',
      },
    ],
    docsUrl: 'https://developers.onelogin.com/openid-connect',
  },

  jumpcloud: {
    id: 'jumpcloud',
    name: 'JumpCloud',
    type: 'oidc',
    description: 'JumpCloud directory platform',
    discoveryUrl: 'https://oauth.id.jumpcloud.com/.well-known/openid-configuration',
    issuer: 'https://oauth.id.jumpcloud.com',
    fields: [],
    docsUrl: 'https://support.jumpcloud.com/s/article/Single-Sign-On-SSO-with-OIDC',
  },

  auth0: {
    id: 'auth0',
    name: 'Auth0',
    type: 'oidc',
    description: 'Auth0 identity platform',
    discoveryUrlTemplate: 'https://{domain}.auth0.com/.well-known/openid-configuration',
    issuerTemplate: 'https://{domain}.auth0.com/',
    fields: [
      {
        name: 'domain',
        label: 'Auth0 Domain',
        placeholder: 'your-tenant',
        description: 'Your Auth0 tenant name (e.g., "your-tenant" from your-tenant.auth0.com)',
      },
    ],
    docsUrl: 'https://auth0.com/docs/get-started/applications',
  },

  ping: {
    id: 'ping',
    name: 'Ping Identity',
    type: 'oidc',
    description: 'PingOne or PingFederate',
    discoveryUrlTemplate:
      'https://auth.pingone.com/{environmentId}/as/.well-known/openid-configuration',
    issuerTemplate: 'https://auth.pingone.com/{environmentId}/as',
    fields: [
      {
        name: 'environmentId',
        label: 'Environment ID',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        description: 'Your PingOne Environment ID',
      },
    ],
    docsUrl: 'https://docs.pingidentity.com/r/en-us/pingone/p1_add_app_oidc',
  },

  // Custom providers
  custom_oidc: {
    id: 'custom_oidc',
    name: 'Custom OIDC',
    type: 'oidc',
    description: 'Configure any OIDC-compliant provider',
    fields: [],
  },

  custom_saml: {
    id: 'custom_saml',
    name: 'Custom SAML',
    type: 'saml',
    description: 'Configure any SAML 2.0 provider',
    fields: [],
  },
} as const

/**
 * Get ordered list of provider templates for display
 * Enterprise providers first, then custom options
 */
export function getOrderedProviderTemplates(): SsoProviderTemplate[] {
  const order = [
    'okta',
    'azure',
    'google_workspace',
    'onelogin',
    'jumpcloud',
    'auth0',
    'ping',
    'custom_oidc',
    'custom_saml',
  ]

  return order.map((id) => SSO_PROVIDER_TEMPLATES[id]).filter(Boolean)
}

/**
 * Build discovery URL from template and field values
 */
export function buildDiscoveryUrl(
  template: SsoProviderTemplate,
  fieldValues: Record<string, string>
): string {
  if (template.discoveryUrl) {
    return template.discoveryUrl
  }

  if (!template.discoveryUrlTemplate) {
    return ''
  }

  let url = template.discoveryUrlTemplate
  for (const [key, value] of Object.entries(fieldValues)) {
    url = url.replace(`{${key}}`, value)
  }
  return url
}

/**
 * Build issuer URL from template and field values
 */
export function buildIssuer(
  template: SsoProviderTemplate,
  fieldValues: Record<string, string>
): string {
  if (template.issuer) {
    return template.issuer
  }

  if (!template.issuerTemplate) {
    return ''
  }

  let url = template.issuerTemplate
  for (const [key, value] of Object.entries(fieldValues)) {
    url = url.replace(`{${key}}`, value)
  }
  return url
}

export type SsoProviderTemplateId = keyof typeof SSO_PROVIDER_TEMPLATES
