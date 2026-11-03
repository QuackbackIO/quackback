/**
 * The resolver every domain check reads DNS through, and the system one used
 * outside tests: sending domains, single sign-on domains and the help center
 * domain alike.
 *
 * A module of its own so a test can replace the whole zone in one place: every
 * lookup the checks make goes through this object, so a fake zone sees every
 * name that was asked for.
 */
import { Resolver } from 'node:dns/promises'

export interface DnsResolver {
  resolveTxt(host: string): Promise<string[][]>
  resolveCname(host: string): Promise<string[]>
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>
  resolve4(host: string): Promise<string[]>
  resolve6(host: string): Promise<string[]>
  resolveNs(host: string): Promise<string[]>
}

/**
 * Two seconds and one try per lookup, so a domain whose nameservers do not
 * answer costs seconds rather than the default's much longer retry cycle.
 * Created on first use; it holds configuration only, nothing per workspace.
 */
let resolver: Resolver | null = null
const shared = (): Resolver => (resolver ??= new Resolver({ timeout: 2000, tries: 1 }))

export const systemResolver: DnsResolver = {
  resolveTxt: (host) => shared().resolveTxt(host),
  resolveCname: (host) => shared().resolveCname(host),
  resolveMx: (host) => shared().resolveMx(host),
  resolve4: (host) => shared().resolve4(host),
  resolve6: (host) => shared().resolve6(host),
  resolveNs: (host) => shared().resolveNs(host),
}
