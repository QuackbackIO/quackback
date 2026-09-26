/** Shared settings for the performance bench. */
import type { Browser, BrowserContextOptions } from '@playwright/test'

export const BENCH_DATABASE_URL =
  process.env.PERF_DATABASE_URL ??
  'postgresql://postgres:password@localhost:5432/quackback_perf_bench'

export const BENCH_PORT = Number(process.env.PERF_PORT ?? 3190)

export const BENCH_URL = `http://localhost:${BENCH_PORT}`

export const ADMIN = { email: 'demo@example.com', password: 'password' }

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
