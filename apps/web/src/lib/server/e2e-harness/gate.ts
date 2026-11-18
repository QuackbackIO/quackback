/**
 * The one gate for every test-only seam the end-to-end suites use: the sweep
 * runner (`/api/e2e/sweep`), the webhook sink allowance in the SSRF guard, and
 * the admin presence switch (`/api/e2e/presence`).
 *
 * Open only when ALL of these hold:
 *
 * 1. `E2E_HARNESS=1` is set. Required in development too: a seam that changes
 *    what the app does (runs a job now, reaches a loopback host) must never be
 *    on just because `NODE_ENV` is not production.
 * 2. `BASE_URL` names a loopback host (`localhost`, `*.localhost`, `127.x`,
 *    `::1`). A deployment people use has a public `BASE_URL`: its links, mail
 *    and cookies are built from it. So a forgotten flag on a real deployment
 *    still finds this closed.
 * 3. The install is not the pooled fleet (`QUACKBACK_TENANCY=pooled`), whose
 *    hosts are never loopback anyway; checked by name so it holds even if a
 *    fleet were misconfigured.
 *
 * Read from the environment on every call (cheap; no caching), so a test can
 * flip it and a process never holds a stale answer.
 */

type EnvLike = Record<string, string | undefined>

/** Is this hostname a loopback name or address? */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  return /^127(?:\.\d{1,3}){3}$/.test(host)
}

/** The hostname of BASE_URL, or null when it is unset or does not parse. */
function baseUrlHostname(env: EnvLike): string | null {
  const raw = env.BASE_URL?.trim()
  if (!raw) return null
  try {
    return new URL(raw).hostname
  } catch {
    return null
  }
}

export function isE2eHarnessEnabled(env: EnvLike = process.env): boolean {
  if (env.E2E_HARNESS !== '1') return false
  if ((env.QUACKBACK_TENANCY ?? '').trim().toLowerCase() === 'pooled') return false
  const host = baseUrlHostname(env)
  return host !== null && isLoopbackHostname(host)
}

/** The response every harness route gives when the gate is closed. */
export function harnessNotFound(): Response {
  return new Response('Not found', { status: 404 })
}
