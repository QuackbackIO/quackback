/**
 * TRUSTED_PROXY_CIDRS: which TCP peers may vouch for a client address.
 *
 * TRUSTED_PROXY_HOPS and TRUSTED_CLIENT_IP_HEADER both assume that every
 * request reaches the app through the operator's proxy. When the app port is
 * also reachable some other way (a published container port, a platform
 * internal address, a second ingress), a client that connects there directly
 * can send those headers itself and pick its own client address.
 *
 * With a CIDR list configured, the client-IP headers (X-Forwarded-For and
 * TRUSTED_CLIENT_IP_HEADER) are read only on a request whose socket peer is
 * inside the list. A peer outside it is the client.
 */
import { BlockList, isIP } from 'node:net'

/** Split a comma-separated CIDR list. Whitespace around entries is ignored. */
function entries(raw: string): string[] {
  return raw.split(',').map((entry) => entry.trim())
}

/**
 * The entries of a `TRUSTED_PROXY_CIDRS` value, or an error naming the first
 * unusable one. An entry is an IPv4 or IPv6 address with an optional `/prefix`;
 * a bare address means that single host. An empty or blank value is no list.
 */
export function parseTrustedProxyCidrs(
  raw: string | undefined
): { ok: true; cidrs: string[] } | { ok: false; entry: string } {
  if (!raw?.trim()) return { ok: true, cidrs: [] }
  const cidrs = entries(raw)
  for (const entry of cidrs) {
    if (!subnetOf(entry)) return { ok: false, entry }
  }
  return { ok: true, cidrs }
}

function subnetOf(entry: string): { ip: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [ip, prefixText, ...extra] = entry.split('/')
  const version = isIP(ip)
  if (!version || extra.length > 0) return null
  // isIP() accepts an IPv6 zone ID ('fe80::1%eth0'), but BlockList.addSubnet
  // throws on it. Refuse it here so it fails at startup, not on a request.
  if (ip.includes('%')) return null
  const max = version === 6 ? 128 : 32
  // Digits only: Number() would also accept '', ' ', '+0' and '1e1'.
  if (prefixText !== undefined && !/^[0-9]+$/.test(prefixText)) return null
  const prefix = prefixText === undefined ? max : Number(prefixText)
  if (prefix > max) return null
  return { ip, prefix, family: version === 6 ? 'ipv6' : 'ipv4' }
}

/**
 * Whether `peer` (a socket address) is inside one of `cidrs`. An IPv4 peer
 * reported in its IPv6-mapped form (`::ffff:192.0.2.7`) matches IPv4 entries.
 * An unusable peer or entry never matches.
 */
export function isTrustedProxyPeer(peer: string, cidrs: readonly string[]): boolean {
  const version = isIP(peer)
  // A zone-scoped peer is link-local and never a proxy we were told about.
  if (!version || peer.includes('%')) return false
  return blockListFor(cidrs).check(peer, version === 6 ? 'ipv6' : 'ipv4')
}

// The list changes only when the config does, so build it once per value
// instead of on every request.
let cached: { key: string; list: BlockList } | null = null

function blockListFor(cidrs: readonly string[]): BlockList {
  const key = cidrs.join(',')
  if (cached?.key === key) return cached.list
  const list = new BlockList()
  for (const entry of cidrs) {
    const subnet = subnetOf(entry.trim())
    if (subnet) list.addSubnet(subnet.ip, subnet.prefix, subnet.family)
  }
  cached = { key, list }
  return list
}
