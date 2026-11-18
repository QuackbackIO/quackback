/**
 * One postgres client per Playwright worker, for reads a test asserts on
 * (email_log rows, presence rows, conversation state). Faster than a script
 * subprocess per read. Writes that change workspace settings still go through
 * the scripts in e2e/scripts, which also bust the settings cache.
 */
import postgres from 'postgres'
import { supportEnv } from './env'

let client: postgres.Sql | null = null

export function supportDb(): postgres.Sql {
  if (!client) client = postgres(supportEnv().databaseUrl, { max: 2, onnotice: () => {} })
  return client
}

export async function closeSupportDb(): Promise<void> {
  if (!client) return
  const open = client
  client = null
  await open.end({ timeout: 5 })
}

/** Poll `read` until it returns a non-null value, or fail with `what`. */
export async function pollFor<T>(
  what: string,
  read: () => Promise<T | null | undefined>,
  { timeoutMs = 10_000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null && value !== undefined) return value
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  const cause = lastError instanceof Error ? ` (last error: ${lastError.message})` : ''
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${cause}`)
}
