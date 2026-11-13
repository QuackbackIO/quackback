/** Shared settings for the performance bench. */
import type { Browser, BrowserContextOptions } from '@playwright/test'

export const BENCH_DATABASE_URL =
  process.env.PERF_DATABASE_URL ??
  'postgresql://postgres:password@localhost:5432/quackback_perf_bench'

export const BENCH_PORT = Number(process.env.PERF_PORT ?? 3190)

export const BENCH_URL = `http://localhost:${BENCH_PORT}`

export const ADMIN = { email: 'demo@example.com', password: 'password' }

/** How much support data a seeded workspace holds. */
export interface PerfProfile {
  teams: number
  /** Spread over the teams, one team each. */
  teammates: number
  companies: number
  /** Customers the conversations belong to; most belong to a company. */
  customers: number
  conversations: number
  /** Messages per conversation, between these bounds (inclusive). */
  messagesPerConversation: { min: number; max: number }
  /** Customer tickets, each riding on its own conversation. */
  tickets: number
  workflows: number
}

/**
 * A busy install: about 200k conversations, 2.5M messages, 50k tickets, 2k
 * companies and 200 teammates in 20 teams. Big enough that a missing index or
 * a scan shows in a plan.
 */
export const LARGE_PROFILE: PerfProfile = {
  teams: 20,
  teammates: 200,
  companies: 2_000,
  customers: 50_000,
  conversations: 200_000,
  messagesPerConversation: { min: 5, max: 20 },
  tickets: 50_000,
  workflows: 300,
}

/**
 * `PERF_SCALE=large` adds {@link LARGE_PROFILE} on top of the demo seed. Unset
 * (or `demo`) seeds the demo workspace alone, as the bench needs.
 */
export function perfScale(raw = process.env.PERF_SCALE): 'demo' | 'large' {
  if (raw === undefined || raw === '' || raw === 'demo') return 'demo'
  if (raw === 'large') return 'large'
  throw new Error(`PERF_SCALE must be "large" or unset, got "${raw}"`)
}

/** The end of stderr a failed start reports. */
const STDERR_TAIL_BYTES = 64 * 1024

/**
 * Boots the production build in `appDir` against the bench database and
 * resolves once it reports ready. `onLine` receives each stdout line; without
 * it stdout is discarded. Stderr is drained as it arrives, so a chatty server
 * never blocks on a full pipe, and its tail explains a failed start.
 */
export async function startBenchServer(
  appDir: string,
  { env = {}, onLine }: { env?: Record<string, string>; onLine?: (line: string) => void } = {}
) {
  const server = Bun.spawn(['bun', '.output/server/index.mjs'], {
    cwd: appDir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      PORT: String(BENCH_PORT),
      BASE_URL: BENCH_URL,
      DATABASE_URL: BENCH_DATABASE_URL,
      SECRET_KEY: process.env.PERF_SECRET_KEY ?? 'perf-bench-secret-key-local-and-ci-only-0000',
      QUACKBACK_ROLE: 'web',
      QUACKBACK_SERVER_TIMING: '1',
      // The settings copy a process keeps for a few seconds would make a count
      // depend on timing; held for the whole run, counts measure a warm process.
      QUACKBACK_SETTINGS_CACHE_MS: String(60 * 60 * 1000),
      ...env,
    },
    stdout: onLine ? 'pipe' : 'ignore',
    stderr: 'pipe',
  })

  if (onLine) {
    void (async () => {
      const decoder = new TextDecoder()
      let buffered = ''
      for await (const chunk of server.stdout as ReadableStream<Uint8Array>) {
        buffered += decoder.decode(chunk, { stream: true })
        let newline: number
        while ((newline = buffered.indexOf('\n')) >= 0) {
          onLine(buffered.slice(0, newline))
          buffered = buffered.slice(newline + 1)
        }
      }
    })()
  }

  let stderrTail = ''
  const stderrDrained = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of server.stderr) {
      stderrTail = (stderrTail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_BYTES)
    }
  })()

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await fetch(`${BENCH_URL}/api/health/ready`).catch(() => null)
    if (ready?.ok) return server
    if (server.exitCode !== null) break
    await Bun.sleep(500)
  }
  server.kill()
  await server.exited
  await stderrDrained.catch(() => {})
  throw new Error(
    `Server did not become ready on ${BENCH_URL}. Run \`bun run build\` and \`bun perf/setup-db.ts\` first.\n` +
      stderrTail.slice(-2000)
  )
}

/** A browser context signed in as the bench admin. */
export async function signedInContext(
  browser: Browser,
  baseURL: string,
  options: BrowserContextOptions = {}
) {
  const context = await browser.newContext({ ...options, baseURL })
  const res = await context.request.post('/api/auth/sign-in/email', {
    data: ADMIN,
    headers: { origin: baseURL },
  })
  if (!res.ok()) throw new Error(`admin sign-in failed: ${res.status()}`)
  return context
}
