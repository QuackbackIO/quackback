/**
 * Font services: hosts that serve a licensed font to the sites that pay for
 * it, through their own code only. Their terms do not allow the files to be
 * copied elsewhere, so Import never takes a file from one.
 */
const FONT_SERVICE_HOSTS = [
  'use.typekit.net',
  'p.typekit.net',
  'typekit.net',
  'typekit.com',
  'fonts.adobe.com',
  'fast.fonts.net',
  'fonts.com',
  'cloud.typography.com',
  'fonts.typotheque.com',
  'webfonts.fontstand.com',
] as const

/** Whether `hostname` is a font service's, or a name under one. */
export function isFontServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return FONT_SERVICE_HOSTS.some((service) => host === service || host.endsWith(`.${service}`))
}

/** Whether the file at `url` is served by a font service. */
export function isFontServiceUrl(url: string): boolean {
  try {
    return isFontServiceHost(new URL(url).hostname)
  } catch {
    return false
  }
}
