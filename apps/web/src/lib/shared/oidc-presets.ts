export interface OidcPreset {
  id: string
  label: string
  issuerPattern: RegExp
  issuerTemplate?: string // shown in the preset picker; user fills in the tenant/org id
}

export const OIDC_PRESETS: OidcPreset[] = [
  {
    id: 'entra',
    label: 'Microsoft Entra ID',
    issuerPattern: /^https:\/\/login\.microsoftonline\.com\//i,
    issuerTemplate: 'https://login.microsoftonline.com/{tenant-id}/v2.0',
  },
  {
    id: 'okta',
    label: 'Okta',
    issuerPattern: /\.okta\.com$/i,
    issuerTemplate: 'https://{your-org}.okta.com',
  },
  {
    id: 'google-workspace',
    label: 'Google Workspace',
    issuerPattern: /^https:\/\/accounts\.google\.com\/?$/i,
    issuerTemplate: 'https://accounts.google.com',
  },
  {
    id: 'onelogin',
    label: 'OneLogin',
    issuerPattern: /\.onelogin\.com$/i,
    issuerTemplate: 'https://{your-org}.onelogin.com/oidc/2',
  },
]

export function detectOidcProvider(issuerUrl: string | undefined | null): OidcPreset | null {
  if (!issuerUrl) return null
  const trimmed = issuerUrl.trim()
  if (!trimmed) return null
  try {
    const host = new URL(trimmed).host
    return (
      OIDC_PRESETS.find((p) => p.issuerPattern.test(trimmed) || p.issuerPattern.test(host)) ?? null
    )
  } catch {
    return null
  }
}
