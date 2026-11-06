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

/** The most a single TXT string can hold, in bytes. */
const TXT_STRING_MAX_BYTES = 255

/**
 * Put back together a long TXT record a runtime returned as separate records.
 *
 * A value longer than 255 bytes is published as one record made of several
 * strings, every one but the last exactly 255 bytes. Node returns that as one
 * record holding all of its strings. Bun returns each string as a record of its
 * own, so a 2048-bit signing key reads as a key cut short at 255 bytes, and a
 * domain that the mail provider has verified stays pending here forever.
 *
 * Bun's answer has lost the record boundaries, so a run of records joined at
 * full 255-byte strings may be one long record or several separate ones. This
 * only adds: every record that came back is kept exactly as it came, and the
 * joined value of each run is added after them. The checks that read TXT all
 * ask whether some record matches what they want, so an added record can make a
 * long key visible but can never hide a record that was really there. An answer
 * in which any record holds more than one string kept its boundaries and is
 * returned as it came.
 */
export function rejoinTxtChunks(records: string[][]): string[][] {
  if (records.some((record) => record.length > 1)) return records
  const full = (record: string[]) =>
    record.length > 0 && Buffer.byteLength(record[record.length - 1]) === TXT_STRING_MAX_BYTES
  const added: string[][] = []
  let i = 0
  while (i < records.length) {
    let end = i
    while (end + 1 < records.length && full(records[end])) end++
    if (end > i) added.push(records.slice(i, end + 1).flat())
    i = end + 1
  }
  return added.length === 0 ? records : [...records, ...added]
}

/**
 * Whether this runtime returns each string of a long TXT record as a record of
 * its own. Read on every lookup rather than once, so a test can stand in for it.
 */
function splitsTxtRecords(): boolean {
  return typeof (process.versions as Record<string, string | undefined>).bun === 'string'
}

/** A TXT answer as Node would give it, whichever runtime asked. */
async function txtRecords(resolver: Resolver, host: string): Promise<string[][]> {
  const records = await resolver.resolveTxt(host)
  return splitsTxtRecords() ? rejoinTxtChunks(records) : records
}

/** One try: for checks that run in the background or on a page load. */
export const systemResolver: DnsResolver = {
  resolveTxt: (host) => txtRecords(shared(1), host),
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
  resolveTxt: (host) => txtRecords(shared(2), host),
  resolveCname: (host) => shared(2).resolveCname(host),
  resolveMx: (host) => shared(2).resolveMx(host),
  resolve4: (host) => shared(2).resolve4(host),
  resolve6: (host) => shared(2).resolve6(host),
  resolveNs: (host) => shared(2).resolveNs(host),
}
