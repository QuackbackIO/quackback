/**
 * The provider fake host map: the e2e suites' way to point the chat and
 * issue-tracker integrations (Slack, Discord, Linear, GitHub, Jira) at one
 * local fake instead of the real provider.
 *
 * A provider request is sent to the fake only when ALL of these hold:
 * - the harness gate is open (`./gate.ts`);
 * - `E2E_PROVIDER_FAKE_URL` is set to an http(s) origin on a loopback host
 *   (`127.x`, `::1`, `localhost`, `*.localhost`), with no credentials, query
 *   or fragment;
 * - the request is `https:`, on the default port, to exactly one of the
 *   provider hosts below.
 *
 * Then `https://<host>/<path>?<query>` becomes `<fake>/<host>/<path>?<query>`:
 * the fake sees which provider was meant from the first path segment. Every
 * other request, and every request when any condition fails, goes where it
 * was addressed, untouched.
 */
import { isE2eHarnessEnabled, isLoopbackHostname } from './gate'

type EnvLike = Record<string, string | undefined>

const FAKE_URL_ENV = 'E2E_PROVIDER_FAKE_URL'

/** The provider hosts the map covers, compared exactly (no subdomains). */
export const E2E_PROVIDER_FAKE_HOSTS: readonly string[] = [
  'slack.com',
  'hooks.slack.com',
  'discord.com',
  'api.linear.app',
  'api.github.com',
  'github.com',
  'api.atlassian.com',
  'auth.atlassian.com',
]

/** The fake's origin, or null when requests must go to the real provider. */
export function e2eProviderFakeOrigin(env: EnvLike = process.env): string | null {
  if (!isE2eHarnessEnabled(env)) return null
  const raw = env[FAKE_URL_ENV]?.trim()
  if (!raw) return null
  let fake: URL
  try {
    fake = new URL(raw)
  } catch {
    return null
  }
  if (fake.protocol !== 'http:' && fake.protocol !== 'https:') return null
  if (fake.username || fake.password || fake.search || fake.hash) return null
  if (!isLoopbackHostname(fake.hostname)) return null
  return fake.origin
}

/**
 * Where a provider request goes in an e2e run: the fake's URL for it, or null
 * when it must go to `url` unchanged.
 */
export function e2eProviderFakeUrl(url: string, env: EnvLike = process.env): string | null {
  const origin = e2eProviderFakeOrigin(env)
  if (!origin) return null
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (target.protocol !== 'https:' || target.port || target.username || target.password) {
    return null
  }
  const host = target.hostname.toLowerCase()
  if (!E2E_PROVIDER_FAKE_HOSTS.includes(host)) return null
  return `${origin}/${host}${target.pathname}${target.search}`
}

/** The Slack Web API base the SDK should use, or undefined for the real one. */
export function e2eSlackApiUrl(env: EnvLike = process.env): string | undefined {
  const origin = e2eProviderFakeOrigin(env)
  return origin ? `${origin}/slack.com/api/` : undefined
}
