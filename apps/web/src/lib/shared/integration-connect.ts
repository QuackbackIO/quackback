/**
 * When platform OAuth app credentials come from env / the control plane,
 * tenants skip the paste-credentials dialog and go straight to Connect.
 */
export function canInstallIntegration(entry: { available: boolean; managed?: boolean }): boolean {
  return entry.available || entry.managed === true
}

export function canEditPlatformCredentials(managed: boolean): boolean {
  return !managed
}

export function showOAuthConnect(opts: {
  hasPlatformCredentialFields: boolean
  platformCredentialsConfigured: boolean
  platformCredentialsManaged: boolean
}): boolean {
  if (!opts.hasPlatformCredentialFields) return true
  return opts.platformCredentialsConfigured || opts.platformCredentialsManaged
}
