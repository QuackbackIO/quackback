/**
 * Web sources — public pages an admin adds by URL for Quinn to ground
 * answers on, alongside the knowledge base and snippets (see
 * `./web-sources-retrieval` for the retrieval half). Adding a source crawls
 * the page once, at write time, through the SSRF-guarded `safeFetch` (a URL
 * resolving to a private/loopback address never reaches the network), and
 * stores the extracted title + readable text; the original URL is kept for
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

/** Decode the handful of named/numeric entities readable page text contains. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
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
}

/**
 * Crawl a public URL and store it as a grounding source. Throws
 * `SsrfError` when the URL fails the SSRF guard (scheme, DNS, or a private
 * resolved address) and `ValidationError` when the response is not a
 * successful HTML page with extractable text — in every rejection path
 * nothing is stored.
 */
export async function addWebSourceFromUrl(input: AddWebSourceInput): Promise<AssistantWebSource> {
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new ValidationError('VALIDATION_ERROR', 'URL is not valid')
  }

  const res = await safeFetch(input.url, {
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

  const { title, content } = extractPage(await res.text())
  if (!content) {
    throw new ValidationError('VALIDATION_ERROR', 'No readable text found on the page')
  }

  const [row] = await db
    .insert(assistantWebSources)
    .values({
      url: input.url,
      title: title || parsed.hostname,
      content,
      fetchedAt: new Date(),
      createdById: input.createdById ?? null,
    })
    .returning()
  log.info({ id: row.id, url: input.url }, 'web source added')
  return row
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
