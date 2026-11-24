/**
 * Whether the portal is on the imported site's own domain. A workspace whose
 * portal is at `feedback.northwind.com` importing `northwind.com` is the
 * brand itself, so the brand assets start confirmed. The portal's hosts are
 * its ready custom domains (Cloud), or the install's own address (self-hosted);
 * the default hosted address never counts, nor any shared hosting name, where
 * a subdomain is anyone's.
 */
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { registrableDomain } from '@/lib/shared/registrable-domain'

/** Hosting names under which each subdomain is a different customer's. */
const SHARED_SUFFIXES = [
  'quackback.io',
  'quackback.app',
  'railway.app',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'fly.dev',
  'onrender.com',
  'pages.dev',
  'workers.dev',
  'github.io',
  'gitlab.io',
  'azurewebsites.net',
  'cloudfront.net',
  'amazonaws.com',
  'web.app',
  'firebaseapp.com',
  'ngrok.io',
  'ngrok.app',
  'ngrok-free.app',
] as const
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'test', 'invalid']

const clean = (host: string) => host.trim().toLowerCase().replace(/\.$/, '')
const under = (host: string, suffixes: readonly string[]) =>
  suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

/** A public name of the brand's own: not an address, a local name or a shared hosting name. */
function ownable(host: string): boolean {
  return (
    host.includes('.') &&
    !/^[\d.]+$/.test(host) &&
    !host.includes(':') &&
    !under(host, LOCAL_SUFFIXES) &&
    !under(host, SHARED_SUFFIXES)
  )
}

/** Whether one of `portalHosts` shares the registrable domain of `siteHost`. */
export function portalOnSite(siteHost: string, portalHosts: readonly string[]): boolean {
  const site = clean(siteHost)
  if (!ownable(site)) return false
  const domain = registrableDomain(site)
  return portalHosts.map(clean).some((host) => ownable(host) && registrableDomain(host) === domain)
}

/**
 * The hosts the portal is served on, for the match. On Cloud, the custom
 * domains that are ready (a pending one is not proven); otherwise the
 * install's own address.
 */
export function portalHostsOf(source: { cloudIdentity: unknown; baseUrl: string }): string[] {
  const identity = parseIdentityProjection(source.cloudIdentity)
  if (identity)
    return identity.customDomains
      .filter((domain) => domain.readiness === 'ready')
      .map((domain) => domain.hostname)
  try {
    return [new URL(source.baseUrl).hostname]
  } catch {
    return []
  }
}

/** The portal's hosts for this workspace, read from its settings and the install's address. */
export async function portalHosts(): Promise<string[]> {
  const [{ db, settings }, { config }] = await Promise.all([
    import('@/lib/server/db'),
    import('@/lib/server/config'),
  ])
  const [row] = await db.select({ cloudIdentity: settings.cloudIdentity }).from(settings).limit(1)
  return portalHostsOf({ cloudIdentity: row?.cloudIdentity ?? null, baseUrl: config.baseUrl })
}
