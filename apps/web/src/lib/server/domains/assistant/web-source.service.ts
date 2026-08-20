/**
 * Web sources — public pages an admin adds by URL for Quinn to ground
 * answers on, alongside the knowledge base and snippets (see
 * `./web-sources-retrieval` for the retrieval half). Adding a source fetches
 * the seed page at write time through the SSRF-guarded `safeFetch` (a URL
 * resolving to a private/loopback address never reaches the network); with
 * crawl enabled the seed's same-origin links are followed too, up to the page
 * cap and within the admin's include/exclude path filters. Each ingested page
 * stores its extracted title + readable text; the original URL is kept for
 * citations. Content is public by construction (the page was publicly
 * fetchable without credentials), so rows carry no audience tier.
 */
import { db, eq, desc, assistantWebSources, type AssistantWebSource } from '@/lib/server/db'
import type { AssistantWebSourceId, PrincipalId } from '@quackback/ids'
import { ValidationError, NotFoundError } from '@/lib/shared/errors'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-web-sources' })

/** Hard cap on the fetched page body — a page is grounding context, not a dump. */
const FETCH_MAX_RESPONSE_BYTES = 1024 * 1024
/** Cap on the stored extracted text; retrieval snippets slice within this. */
const CONTENT_MAX_LENGTH = 20000
const TITLE_MAX_LENGTH = 200
/** Default and hard ceiling for pages ingested by one crawl-enabled source. */
const CRAWL_DEFAULT_MAX_PAGES = 25
const CRAWL_MAX_PAGES_CEILING = 100

/** Decode the handful of named/numeric entities readable page text contains. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Last, so `&amp;lt;` decodes to the literal `&lt;` instead of `<`.
    .replace(/&amp;/g, '&')
}

/**
 * Reduce an HTML page to its readable text: drop script/style/noscript
 * subtrees, take the `<title>` for the title, strip every remaining tag, and
 * collapse whitespace. Deliberately a plain-text extraction, not a reader
 * mode — the model gets the page's words, not its chrome.
 */
export function extractPage(html: string): { title: string; content: string } {
  const withoutSubtrees = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(withoutSubtrees)
  const title = decodeEntities(titleMatch?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX_LENGTH)
  const content = decodeEntities(withoutSubtrees.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONTENT_MAX_LENGTH)
  return { title, content }
}

export interface AddWebSourceInput {
  url: string
  createdById?: PrincipalId
  /** Crawl same-origin pages linked from the seed URL instead of the seed alone. */
  crawl?: boolean
  /**
   * Admin path globs (`*` wildcard) applied to discovered links — never to the
   * seed URL itself. A non-empty include list admits only matching paths; an
   * exclude match always wins.
   */
  includePaths?: string[]
  excludePaths?: string[]
  /** Pages ingested per source, capped at the ceiling regardless of input. */
  maxPages?: number
}

/** Same-origin, hash-stripped, http(s)-only link targets found in a page. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>()
  const hrefRe = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match: RegExpExecArray | null
  while ((match = hrefRe.exec(html)) !== null) {
    const href = match[1] ?? match[2] ?? match[3] ?? ''
    try {
      const resolved = new URL(href, baseUrl)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
      resolved.hash = ''
      links.add(resolved.toString())
    } catch {
      // A malformed href is not a crawl target.
    }
  }
  return [...links]
}

/** Include-then-exclude glob matching against a URL path; `*` spans any run. */
export function matchesPathFilters(
  path: string,
  includePaths: string[],
  excludePaths: string[]
): boolean {
  const toRe = (glob: string) =>
    new RegExp(`^${glob.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : `\\${c}`))}$`)
  if (excludePaths.some((g) => toRe(g).test(path))) return false
  if (includePaths.length > 0 && !includePaths.some((g) => toRe(g).test(path))) return false
  return true
}

interface FetchedPage {
  url: string
  title: string
  content: string
  html: string
}

/** Fetch one page through the SSRF guard and validate it is readable HTML. */
async function fetchPage(url: string): Promise<FetchedPage> {
  const res = await safeFetch(url, {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml' },
    timeoutMs: 10000,
    maxResponseBytes: FETCH_MAX_RESPONSE_BYTES,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new ValidationError('VALIDATION_ERROR', `URL returned status ${res.status}`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new ValidationError('VALIDATION_ERROR', 'URL did not return an HTML page')
  }
  const html = await res.text()
  const { title, content } = extractPage(html)
  if (!content) {
    throw new ValidationError('VALIDATION_ERROR', 'No readable text found on the page')
  }
  return { url, title, content, html }
}

async function insertPage(
  page: FetchedPage,
  fallbackTitle: string,
  createdById: PrincipalId | undefined
): Promise<AssistantWebSource | undefined> {
  const [row] = await db
    .insert(assistantWebSources)
    .values({
      url: page.url,
      title: page.title || fallbackTitle,
      content: page.content,
      fetchedAt: new Date(),
      createdById: createdById ?? null,
    })
    // A page already stored by an earlier source/crawl is left untouched.
    .onConflictDoNothing({ target: assistantWebSources.url })
    .returning()
  return row
}

/**
 * Crawl a public URL and store it as a grounding source. Throws
 * `SsrfError` when the URL fails the SSRF guard (scheme, DNS, or a private
 * resolved address) and `ValidationError` when the response is not a
 * successful HTML page with extractable text — in every rejection path
 * nothing is stored.
 *
 * With `crawl` enabled the seed's same-origin links are followed breadth-first
 * up to the page cap, honoring the admin's include/exclude path filters. A
 * page that fails to fetch or extract mid-crawl is skipped, not fatal; only
 * the seed URL's failure rejects the whole add.
 */
export async function addWebSourceFromUrl(input: AddWebSourceInput): Promise<AssistantWebSource> {
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new ValidationError('VALIDATION_ERROR', 'URL is not valid')
  }

  if (!input.crawl) {
    const page = await fetchPage(input.url)
    const [row] = await db
      .insert(assistantWebSources)
      .values({
        url: input.url,
        title: page.title || parsed.hostname,
        content: page.content,
        fetchedAt: new Date(),
        createdById: input.createdById ?? null,
      })
      .returning()
    log.info({ id: row.id, url: input.url }, 'web source added')
    return row
  }

  const maxPages = Math.min(input.maxPages ?? CRAWL_DEFAULT_MAX_PAGES, CRAWL_MAX_PAGES_CEILING)
  const includePaths = input.includePaths ?? []
  const excludePaths = input.excludePaths ?? []
  const origin = parsed.origin

  const queue = [input.url]
  const seen = new Set(queue)
  let stored = 0
  let rootRow: AssistantWebSource | undefined

  while (queue.length > 0 && stored < maxPages) {
    const url = queue.shift()!
    const isSeed = url === input.url
    let page: FetchedPage
    try {
      page = await fetchPage(url)
    } catch (err) {
      if (isSeed) throw err
      log.warn({ url, err }, 'crawl skipped a page that failed to fetch or extract')
      continue
    }

    const row = await insertPage(page, parsed.hostname, input.createdById)
    if (row) {
      stored += 1
      if (isSeed) rootRow = row
      log.info({ id: row.id, url }, 'web source page ingested')
    }

    for (const link of extractLinks(page.html, url)) {
      if (seen.has(link)) continue
      seen.add(link)
      let linkUrl: URL
      try {
        linkUrl = new URL(link)
      } catch {
        continue
      }
      if (linkUrl.origin !== origin) continue
      if (!matchesPathFilters(linkUrl.pathname, includePaths, excludePaths)) continue
      queue.push(link)
    }
  }

  if (!rootRow) {
    // The seed URL was already stored by an earlier add; return that row.
    const [existing] = await db
      .select()
      .from(assistantWebSources)
      .where(eq(assistantWebSources.url, input.url))
    rootRow = existing
  }
  log.info({ url: input.url, pages: stored }, 'web source crawl finished')
  return rootRow
}

/** All web sources, enabled or not, newest first. */
export async function listWebSources(): Promise<AssistantWebSource[]> {
  return db.select().from(assistantWebSources).orderBy(desc(assistantWebSources.createdAt))
}

export async function setWebSourceEnabled(
  id: AssistantWebSourceId,
  enabled: boolean
): Promise<AssistantWebSource> {
  const [row] = await db
    .update(assistantWebSources)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(assistantWebSources.id, id))
    .returning()
  if (!row) throw new NotFoundError('NOT_FOUND', 'Web source not found')
  log.info({ id, enabled }, 'web source toggled')
  return row
}

export async function deleteWebSource(id: AssistantWebSourceId): Promise<void> {
  await db.delete(assistantWebSources).where(eq(assistantWebSources.id, id))
  log.info({ id }, 'web source deleted')
}
