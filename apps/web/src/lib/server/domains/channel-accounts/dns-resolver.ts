/**
 * The resolver sending-domain checks read DNS through, and the system one they
 * use outside tests.
 *
 * A module of its own so a test can replace the whole zone in one place: every
 * lookup the checks make goes through this object, so a fake zone sees every
 * name that was asked for.
 */
import { resolve4, resolveCname, resolveMx, resolveNs, resolveTxt } from 'node:dns/promises'

export interface DnsResolver {
  resolveTxt(host: string): Promise<string[][]>
  resolveCname(host: string): Promise<string[]>
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>
  resolve4(host: string): Promise<string[]>
  resolveNs(host: string): Promise<string[]>
}

export const systemResolver: DnsResolver = {
  resolveTxt: (host) => resolveTxt(host),
  resolveCname: (host) => resolveCname(host),
  resolveMx: (host) => resolveMx(host),
  resolve4: (host) => resolve4(host),
  resolveNs: (host) => resolveNs(host),
}
