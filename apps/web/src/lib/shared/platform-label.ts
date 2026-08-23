/** System hosts minted at provision: `ws-` + 24 hex chars. Not a customer URL. */
const GENERATED_SYSTEM_LABEL = /^ws-[0-9a-f]{24}$/i

export function platformLabelFromHostname(hostname: string): string {
  return hostname.split('.')[0] ?? ''
}

export function isGeneratedSystemLabel(value: string): boolean {
  const label = value.includes('.') ? (value.split('.')[0] ?? '') : value.trim()
  return GENERATED_SYSTEM_LABEL.test(label)
}

/** Label to show in a friendly-URL field. Generated system hosts stay blank. */
export function friendlyPlatformLabel(hostname: string | null | undefined): string {
  if (!hostname) return ''
  const label = platformLabelFromHostname(hostname)
  return isGeneratedSystemLabel(label) ? '' : label
}

/** Registrable suffix of a hostname (`acme.quackback.co.uk` → `quackback.co.uk`). */
export function hostnameRegistrableSuffix(hostname: string): string {
  return hostname.split('.').slice(1).join('.')
}

/**
 * Suffix shown next to the Workspace URL field.
 * Always taken from `platformHostname` when one exists — `canonicalOrigin`
 * becomes a custom domain after that domain is made primary.
 */
export function platformUrlSuffix(identity: {
  platformHostname: string | null
  canonicalOrigin: string
}): string {
  const host = identity.platformHostname ?? new URL(identity.canonicalOrigin).hostname
  return hostnameRegistrableSuffix(host)
}
