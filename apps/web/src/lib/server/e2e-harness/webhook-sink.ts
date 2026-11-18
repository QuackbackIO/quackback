/**
 * The webhook sink allowance: the one exception the SSRF guard makes, and only
 * for outgoing webhooks, so the e2e suites can watch deliveries arrive.
 *
 * A URL is the sink only when ALL of these hold:
 * - the harness gate is open (`./gate.ts`);
 * - `E2E_WEBHOOK_SINK_HOST` names it, as `host:port`, compared exactly;
 * - that configured hostname is itself a loopback name (`*.localhost`), so the
 *   variable cannot be pointed at a private network address;
 * - the URL is `https:`.
 *
 * Even then the guard only lets it resolve to loopback addresses (127.0.0.0/8
 * or ::1), never to any other private range, and the certificate is still
 * verified (the suite trusts its own CA through NODE_EXTRA_CA_CERTS).
 */
import { isE2eHarnessEnabled, isLoopbackHostname } from './gate'

type EnvLike = Record<string, string | undefined>

const SINK_HOST_ENV = 'E2E_WEBHOOK_SINK_HOST'

export function isE2eWebhookSinkUrl(url: string, env: EnvLike = process.env): boolean {
  if (!isE2eHarnessEnabled(env)) return false
  const configured = env[SINK_HOST_ENV]?.trim().toLowerCase()
  if (!configured) return false
  let sink: URL
  let target: URL
  try {
    sink = new URL(`https://${configured}`)
    target = new URL(url)
  } catch {
    return false
  }
  if (!isLoopbackHostname(sink.hostname) || /^[\d.]+$|:/.test(sink.hostname)) return false
  if (target.protocol !== 'https:') return false
  return target.host.toLowerCase() === sink.host
}

/** Is this resolved address a loopback address (and nothing wider)? */
export function isLoopbackAddress(address: string): boolean {
  const addr = address.toLowerCase()
  if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true
  const mapped = addr.startsWith('::ffff:') ? addr.slice('::ffff:'.length) : addr
  return /^127(?:\.\d{1,3}){3}$/.test(mapped)
}
