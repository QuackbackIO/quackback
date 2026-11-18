/**
 * Presence for teammates under test.
 *
 * The admin app keeps presence off in automated browsers on purpose
 * (use-admin-presence.ts). Two ways to turn it on in a test:
 *
 * - In a browser: open any admin URL through `withPresenceFlag(path)`. The app
 *   remembers the flag for the tab and, once the server confirms the e2e
 *   harness is on, opens the presence stream like a person's browser would.
 * - Without a browser: `holdPresence(person)` opens the presence stream from
 *   the test process with that person's session, until `release()`.
 *
 * `setAvailability` flips the persisted Online/Away choice; `presenceRows`
 * reads what the app recorded.
 */
import { readFileSync } from 'node:fs'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'
import { personStatePath, type SupportPersonName } from './people'

export const PRESENCE_QUERY_FLAG = 'e2e-presence'

/** Add the presence flag to an admin path. */
export function withPresenceFlag(path: string): string {
  const url = new URL(path, 'http://placeholder')
  url.searchParams.set(PRESENCE_QUERY_FLAG, '1')
  return `${url.pathname}${url.search}${url.hash}`
}

/** The Cookie header a person's stored session sends. */
export function sessionCookieHeader(person: SupportPersonName): string {
  const state = JSON.parse(readFileSync(personStatePath(person), 'utf8')) as {
    cookies: Array<{ name: string; value: string; secure: boolean }>
  }
  const secure = supportEnv().baseUrl.startsWith('https://')
  return state.cookies
    .filter((c) => c.secure === secure)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

export interface PresenceRow {
  principal_id: string
  stream_id: string
  is_agent: boolean
  heartbeat_at: Date
}

export async function presenceRows(principalId: string): Promise<PresenceRow[]> {
  return supportDb()<PresenceRow[]>`
    SELECT principal_id, stream_id, is_agent, heartbeat_at
    FROM presence_stream WHERE principal_id = ${principalId}`
}

/** Wait until the person has (or, with `present: false`, has no) presence row. */
export async function waitForPresence(
  principalId: string,
  present = true,
  timeoutMs = 10_000
): Promise<PresenceRow[]> {
  return pollFor(
    `${present ? 'a' : 'no'} presence row for ${principalId}`,
    async () => {
      const rows = await presenceRows(principalId)
      return (present ? rows.length > 0 : rows.length === 0) ? rows : null
    },
    { timeoutMs }
  )
}

/**
 * Hold a presence stream open for `person` from the test process. Resolves
 * once the server answered the stream; call `release()` to close it.
 */
export async function holdPresence(person: SupportPersonName): Promise<{ release: () => void }> {
  const controller = new AbortController()
  const res = await fetch(`${supportEnv().baseUrl}/api/chat/stream?scope=presence`, {
    headers: { cookie: sessionCookieHeader(person), accept: 'text/event-stream' },
    signal: controller.signal,
  })
  if (!res.ok || !res.body) {
    controller.abort()
    throw new Error(`presence stream for ${person} answered ${res.status}`)
  }
  // Drain in the background so the server's writes never block.
  const reader = res.body.getReader()
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        // keep reading heartbeats
      }
    } catch {
      // aborted
    }
  })()
  return { release: () => controller.abort() }
}

/** Set a teammate's persisted Online/Away choice. */
export async function setAvailability(
  principalId: string,
  availability: 'online' | 'away'
): Promise<void> {
  const { toUuid } = await import('@quackback/ids')
  await supportDb()`
    UPDATE principal SET chat_availability = ${availability}
    WHERE id = ${toUuid(principalId as `principal_${string}`)}`
}
