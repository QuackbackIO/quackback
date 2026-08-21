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
