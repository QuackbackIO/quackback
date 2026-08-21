/**
 * Edge retry for a cold or restarting origin replica.
 *
 * `SAAS-HOSTING-STACK.md` §1/§9: the first request to a slept Railway service
 * *may* return 502, and that "needs an edge retry at the Cloudflare layer
 * before this is customer-facing".
 *
 * ## What was measured before writing this
 *
 * On Railway (2026-08-09, `quackback-web-sleeper`, `deploy.sleepApplication`
 * true, `healthcheckPath` set) the platform did **not** surface a 502:
 *
 * - 8 consecutive requests to a service the API reported `SLEEPING`: all 200,
 *   first in 2.84 s, the rest in ~0.18 s.
 * - 107 requests at 2/s spanning a full replica replacement (`railway redeploy`,
 *   old replica REMOVED, new one SUCCESS): all 200, zero non-200.
 * - Positive control, so the probe is not merely blind: with the deployment
 *   removed entirely, 12/12 requests returned 404 in ~0.16 s. The probe can see
 *   a broken origin; it saw none during the wake or the restart.
 *
 * So on today's Railway the edge already holds the connection through both
 * cases. This exists because "may 502" is the documented contract and one clean
 * trial is not a guarantee — a retry is cheap and its absence is only ever
 * discovered by a customer.
 *
 * ## Status: NOT DEPLOYED
 *
 * The wildcard `*.quackback.co.uk` is DNS-only (grey cloud) so that Railway's
 * DNS-01 certificate issues, which means no Cloudflare code is in the request
 * path at all, and this run's Cloudflare API credentials are expired
 * (`/user/tokens/verify` → 6003, the OAuth token → 9109). This file is
 * therefore the artifact, not a running control. Deploy it with a route on
 * `*.quackback.io/*` once the traffic CNAMEs are proxied.
 *
 * ## Why only idempotent methods are retried
 *
 * A 502 means the origin never answered — but not that it never *received*. A
 * retried POST is a duplicated mutation, and this whole architecture exists to
 * avoid the class of bug where something plausible happens twice. GET and HEAD
 * are safe; everything else is passed through with its 502 intact.
 */

/** Statuses that mean "the origin was not there", not "the origin said no". */
const RETRYABLE = new Set([502, 503, 504, 521, 522, 523, 524])

/** Total budget. A slept Railway replica woke in 2.84 s when measured. */
const ATTEMPTS = 4
const BACKOFF_MS = [250, 750, 1500]

export default {
  async fetch(request, env, ctx) {
    const idempotent = request.method === 'GET' || request.method === 'HEAD'

    let response = await fetch(request)
    if (!idempotent || !RETRYABLE.has(response.status)) return response

    for (let attempt = 1; attempt < ATTEMPTS; attempt++) {
      // Drain the body so the connection is not left open while we wait.
      await response.body?.cancel()
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]))
      response = await fetch(request)
      if (!RETRYABLE.has(response.status)) {
        // Mark it so a cold start is visible in analytics rather than invisible:
        // "no user saw an error" must not become "nobody knows it happened".
        const out = new Response(response.body, response)
        out.headers.set('x-quackback-origin-retries', String(attempt))
        return out
      }
    }
    return response
  },
}
