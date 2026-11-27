/**
 * Workspace settings a serial spec changes and puts back (support-serial
 * project only: nothing else runs meanwhile). Each setter returns a restore
 * function; call it in afterEach/afterAll.
 */
import { supportDb } from './db'

async function bustSettings(): Promise<void> {
  await supportDb()`DELETE FROM kv_store WHERE key = 'settings:workspace'`
}

/**
 * Turn the widget assistant on or off. With it off the widget's thread header
 * shows the team and its status line ("Online now" / "We'll reply by email").
 */
export async function setWidgetAssistant(
  enabled: boolean,
  respond?: boolean
): Promise<() => Promise<void>> {
  const sql = supportDb()
  const [row] = await sql<
    { widget_config: string | null }[]
  >`SELECT widget_config FROM settings LIMIT 1`
  const original = row.widget_config
  const config = JSON.parse(original ?? '{}') as {
    messenger?: { assistant?: Record<string, unknown> }
  }
  config.messenger = {
    ...config.messenger,
    assistant: {
      ...config.messenger?.assistant,
      enabled,
      ...(respond === undefined ? {} : { respond }),
    },
  }
  await sql`UPDATE settings SET widget_config = ${JSON.stringify(config)}`
  await bustSettings()
  return async () => {
    await sql`UPDATE settings SET widget_config = ${original}`
    await bustSettings()
  }
}

/** Start every presence assertion from nobody online. */
export async function clearPresence(): Promise<void> {
  await supportDb()`DELETE FROM presence_stream`
}
