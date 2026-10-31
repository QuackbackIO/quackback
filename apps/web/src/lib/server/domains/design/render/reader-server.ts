/**
 * The website reader's service, run in a container of its own beside
 * Quackback. It answers `POST /read` for callers holding its token, one read
 * at a time, each read in a fresh process that is ended if it runs over time,
 * so a page that hangs or leaks takes nothing with it.
 *
 *   QUACKBACK_BROWSER_TOKEN  required; callers send it as a bearer token
 *   PORT                     default 3200
 *   QUACKBACK_BROWSER_PATH   the Chromium to drive, when not on PATH
 *
 * Run with an argument of `read <url>`, it performs one read and prints it.
 */
import { timingSafeEqual } from 'node:crypto'
import { logger } from '@/lib/server/logger'
import { parseWebsiteInput, isStandardWebsiteUrl } from '@/lib/shared/website-branding'
import { readPage, type PageRead } from './read-page'

const log = logger.child({ module: 'browser-reader' })

const READ_MS = 45_000
const MAX_WAITING = 4
const OUTPUT_BYTES = 4 * 1024 * 1024
/** Marks the read in a child's output, past anything else it prints. */
const MARK = '\n@@quackback-read@@'

/** Whether a request carries the service's token. */
export function authorised(header: string | null, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '')
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Runs reads one after another, refusing more than a few waiting. */
export function readQueue(read: (url: string) => Promise<PageRead>) {
  let tail: Promise<unknown> = Promise.resolve()
  let waiting = 0
  return (url: string): Promise<PageRead> | null => {
    if (waiting >= MAX_WAITING) return null
    waiting++
    const next = tail.then(() => read(url)).finally(() => waiting--)
    tail = next.catch(() => undefined)
    return next
  }
}

/** One read in a process of its own, ended when it overruns. */
async function readInProcess(url: string): Promise<PageRead> {
  const child = Bun.spawn([process.execPath, process.argv[1]!, 'read', url], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: process.env,
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), READ_MS)
  try {
    const text = await new Response(child.stdout).text()
    await child.exited
    const at = text.lastIndexOf(MARK)
    if (at < 0 || text.length > OUTPUT_BYTES) return { ok: false, reason: 'unreachable' }
    return JSON.parse(text.slice(at + MARK.length)) as PageRead
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

async function serve() {
  const token = process.env.QUACKBACK_BROWSER_TOKEN
  if (!token || token.length < 16) {
    log.error('QUACKBACK_BROWSER_TOKEN must be set to at least 16 characters')
    process.exit(1)
  }
  const enqueue = readQueue(readInProcess)
  const server = Bun.serve({
    hostname: '::',
    port: Number(process.env.PORT) || 3200,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method === 'GET' && path === '/health') return new Response('ok')
      if (request.method !== 'POST' || path !== '/read')
        return new Response('Not found', { status: 404 })
      if (!authorised(request.headers.get('authorization'), token))
        return new Response('Unauthorised', { status: 401 })
      const body = (await request.json().catch(() => null)) as { url?: unknown } | null
      const url = typeof body?.url === 'string' ? parseWebsiteInput(body.url) : null
      if (!url || !isStandardWebsiteUrl(url))
        return Response.json({ ok: false, reason: 'invalid' }, { status: 400 })
      const pending = enqueue(url.toString())
      if (!pending) return Response.json({ ok: false, reason: 'busy' }, { status: 429 })
      const started = Date.now()
      const result = await pending
      log.info(
        {
          host: url.hostname,
          ok: result.ok,
          ms: Date.now() - started,
          ...(result.ok ? {} : { reason: result.reason }),
        },
        'read a website'
      )
      return Response.json(result)
    },
  })
  log.info({ port: server.port }, 'website reader listening')
}

async function readOnce(url: string) {
  const result = await readPage(url, process.env.QUACKBACK_BROWSER_PATH).catch((): PageRead => ({
    ok: false,
    reason: 'unreachable',
  }))
  process.stdout.write(MARK + JSON.stringify(result))
  process.exit(0)
}

if (import.meta.main) {
  if (process.argv[2] === 'read' && process.argv[3]) void readOnce(process.argv[3])
  else void serve()
}
