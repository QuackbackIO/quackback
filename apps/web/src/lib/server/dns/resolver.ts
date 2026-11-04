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
 * Two seconds per try, so a domain whose nameservers do not answer costs
 * seconds rather than the default's much longer retry cycle. One resolver per
 * try count, created on first use; each holds configuration only, nothing per
 * workspace.
 */
const resolvers = new Map<number, Resolver>()

function shared(tries: number): Resolver {
  let resolver = resolvers.get(tries)
  if (!resolver) {
    resolver = new Resolver({ timeout: 2000, tries })
    resolvers.set(tries, resolver)
  }
  return resolver
}

/** One try: for checks that run in the background or on a page load. */
export const systemResolver: DnsResolver = {
  resolveTxt: (host) => shared(1).resolveTxt(host),
  resolveCname: (host) => shared(1).resolveCname(host),
  resolveMx: (host) => shared(1).resolveMx(host),
  resolve4: (host) => shared(1).resolve4(host),
  resolve6: (host) => shared(1).resolve6(host),
  resolveNs: (host) => shared(1).resolveNs(host),
}

/**
 * Two tries: for a lookup someone clicked a button for and is waiting on, where
 * a single dropped packet would read as a missing record.
 */
export const interactiveResolver: DnsResolver = {
  resolveTxt: (host) => shared(2).resolveTxt(host),
  resolveCname: (host) => shared(2).resolveCname(host),
  resolveMx: (host) => shared(2).resolveMx(host),
  resolve4: (host) => shared(2).resolve4(host),
  resolve6: (host) => shared(2).resolve6(host),
  resolveNs: (host) => shared(2).resolveNs(host),
}
