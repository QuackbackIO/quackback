/**
 * The resolver every domain check reads DNS through, and the system one used
 * outside tests: sending domains, single sign-on domains and the help center
 * domain alike.
 *
 * A module of its own so a test can replace the whole zone in one place: every
 * lookup the checks make goes through this object, so a fake zone sees every
 * name that was asked for.
 *
 * TXT is read off the wire by `queryTxt` rather than the runtime's resolver,
 * because Bun loses the boundaries between a long record's strings (see
 * `txt-query.ts`). The other record types go through the runtime as before.
 */
import { Resolver } from 'node:dns/promises'
import { queryTxt } from './txt-query'

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
const TIMEOUT_MS = 2000
const resolvers = new Map<number, Resolver>()

function shared(tries: number): Resolver {
  let resolver = resolvers.get(tries)
  if (!resolver) {
    resolver = new Resolver({ timeout: TIMEOUT_MS, tries })
    resolvers.set(tries, resolver)
  }
  return resolver
}

/** One try: for checks that run in the background or on a page load. */
export const systemResolver: DnsResolver = {
  resolveTxt: (host) => queryTxt(host, { timeoutMs: TIMEOUT_MS, tries: 1 }),
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
  resolveTxt: (host) => queryTxt(host, { timeoutMs: TIMEOUT_MS, tries: 2 }),
  resolveCname: (host) => shared(2).resolveCname(host),
  resolveMx: (host) => shared(2).resolveMx(host),
  resolve4: (host) => shared(2).resolve4(host),
  resolve6: (host) => shared(2).resolve6(host),
  resolveNs: (host) => shared(2).resolveNs(host),
}
